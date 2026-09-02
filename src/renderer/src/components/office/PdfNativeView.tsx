/**
 * PDF.js viewer — performance via virtualization, not product page caps:
 *  - All pages get light slots; paint only when near viewport (IO)
 *  - Fit/zoom changes are CSS transforms first (no page.render per frame)
 *  - Idle + large scale drift: quality re-paint of painted pages
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PreviewBlock } from '@shared/previewBlock'
import { isOfficeLockFile, OFFICE_LOCK_FILE_MESSAGE } from '@shared/officeLock'
import { computeFitScale, stageUsableWidth } from '../../lib/docZoom'
import { scheduleClickPick } from '../../lib/clickPick'
import { useT } from '../../i18n/useT'
import { PagePager } from './PagePager'
import { DocZoomControls, DOC_ZOOM_STEP } from './DocZoomControls'
import { useDocZoom } from './useDocZoom'
import { useDocumentPageIndex } from './useDocumentPageIndex'
import { writeDocZoom } from '../../lib/selectionChrome'

type PdfJsModule = typeof import('pdfjs-dist')
type PdfDocument = Awaited<ReturnType<PdfJsModule['getDocument']>['promise']>
type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>
type RenderTask = { promise: Promise<void>; cancel: () => void }

/**
 * Same-origin public/pdfjs/ (cmaps, fonts, worker) — see electron.vite.config.
 * Must be resolved from the page URL: a leading `/pdfjs/` becomes `file:///pdfjs/`
 * under Electron `loadFile`, which 404s the worker.
 */
function pdfAssetBase(): string {
  try {
    return new URL('pdfjs/', window.location.href).href
  } catch {
    return '/pdfjs/'
  }
}

let pdfjsPromise: Promise<PdfJsModule> | null = null

async function getPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist')
      // Static worker URL — never `import('…/worker?url')` (Electron /@fs fails).
      pdfjs.GlobalWorkerOptions.workerSrc = `${pdfAssetBase()}pdf.worker.min.mjs`
      return pdfjs
    })().catch((err) => {
      pdfjsPromise = null
      throw err
    })
  }
  return pdfjsPromise
}

/** Quality re-paint only after resize/zoom fully settles. */
const QUALITY_IDLE_MS = 520
/** Re-paint only if display width drifted this much vs the last canvas paint. */
const QUALITY_WIDTH_RATIO = 0.12
/** First paint: only page 1 (canvas). Neighbours fill in after first frame. */
const EAGER_PAGES = 2
/**
 * Soft paint budget in CSS pixels (not a product page-size cap).
 * Deep zoom keeps rasterising up to here, then rides a CSS upscale rather than
 * allocating multi-GB bitmaps.
 */
const PAINT_WIDTH_BUDGET = 2000
/** How many lightweight page frames to insert per idle chunk (large books). */
const PLACEHOLDER_CHUNK = 40
/** pdf.js unit is 1/72in; CSS is 96dpi. 100% zoom means the page at 96dpi. */
const PDF_TO_CSS_UNITS = 96 / 72

function scaleForWidth(pageWidthPt: number, cssTarget: number): number {
  const target = Math.max(160, Math.min(cssTarget, PAINT_WIDTH_BUDGET))
  // A4 ≈ 595pt → scale ≈ 1.33 at its 794 CSS px 100% width.
  return Math.max(0.45, Math.min(6, target / pageWidthPt))
}

function pdfUrlForPath(filePath: string, revision = 0): string {
  const base = `vav-local://preview/?path=${encodeURIComponent(filePath)}`
  return revision ? `${base}&rev=${revision}` : base
}

interface PageSlot {
  pageNum: number
  frame: HTMLDivElement
  pageEl: HTMLDivElement
  canvas: HTMLCanvasElement
  textLayer: HTMLDivElement
  /** Page size at 100% zoom, in CSS px. */
  naturalW: number
  naturalH: number
  /** CSS pixel size of last canvas paint (pre display-scale). */
  paintW: number
  paintH: number
  /** pdf.js scale used for last paint. */
  paintScale: number
  page: PdfPage | null
  renderTask: RenderTask | null
  painted: boolean
}

export function PdfNativeView({
  path,
  revision = 0,
  selecting,
  selectedIds,
  onPick,
  onReady
}: {
  path: string
  revision?: number
  selecting: boolean
  selectedIds: string[]
  onPick: (block: PreviewBlock, event: MouseEvent) => void
  onReady?: () => void
}): React.JSX.Element {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pageTotal, setPageTotal] = useState(0)
  const [naturalWidth, setNaturalWidth] = useState(0)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const selectingRef = useRef(selecting)
  selectingRef.current = selecting
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds

  /** Current zoom, read by the imperative render loop below. */
  const scaleRef = useRef(1)
  const atFitRef = useRef(true)
  /** Wired by the render effect; null until a document is mounted. */
  const applyCssFitRef = useRef<(() => void) | null>(null)
  const scheduleQualityRef = useRef<(() => void) | null>(null)

  const applyScale = useCallback((scale: number): void => {
    scaleRef.current = scale
    applyCssFitRef.current?.()
    scheduleQualityRef.current?.()
  }, [])

  const zoom = useDocZoom({
    stageRef: hostRef,
    contentRef: trackRef,
    naturalWidth,
    apply: applyScale,
    enabled: !error
  })
  atFitRef.current = zoom.atFit

  const pageIndex = useDocumentPageIndex({
    scrollRef: hostRef,
    pageSelector: '.pdf-page-frame[data-page-number]',
    enabled: !error && pageTotal > 0,
    totalOverride: pageTotal > 0 ? pageTotal : null,
    pageNumberFromEl: (el) => Number(el.dataset.pageNumber) || 1
  })

  useEffect(() => {
    let cancelled = false
    let loadingTask: { destroy: () => void } | null = null
    let doc: PdfDocument | null = null
    let pdfjs: PdfJsModule | null = null
    let slots: PageSlot[] = []
    /** Page-1 width at 100% zoom, in CSS px — the fit reference for the doc. */
    let naturalPageW = 0
    /** Canvas target width used for the last full paint (drift detector). */
    let paintedTargetW = 0
    let qualityTimer: ReturnType<typeof setTimeout> | null = null
    let qualityRunning = false
    let io: IntersectionObserver | null = null
    const host = hostRef.current
    if (!host) return

    /** All page frames live in one track so the stage can centre/measure them. */
    const track = document.createElement('div')
    track.className = 'pdf-pages-track'

    const applySelectionChrome = (): void => {
      const set = new Set(selectedIdsRef.current)
      host.querySelectorAll<HTMLElement>('.textLayer span[data-line-id]').forEach((el) => {
        const lineId = el.dataset.lineId
        el.classList.toggle('selected', !!lineId && set.has(lineId))
      })
      host.querySelectorAll<HTMLElement>('.pdf-page').forEach((el) => {
        const id = `pdf-page-${el.dataset.pageNumber ?? ''}`
        el.classList.toggle('selected', set.has(id))
      })
    }

    /** Canvas raster width the current zoom asks for, before the paint budget. */
    const targetPaintWidth = (): number =>
      Math.min(PAINT_WIDTH_BUDGET, Math.max(160, naturalPageW * scaleRef.current))

    /**
     * Lay every frame out at the current zoom. Painted pages ride a CSS scale
     * off their last raster until the quality pass catches up, so a pinch is a
     * transform per page and never a re-render.
     */
    const applyCssFit = (): void => {
      const scale = scaleRef.current
      for (const slot of slots) {
        if (slot.naturalW <= 0 || slot.naturalH <= 0) continue
        // Floor, never ceil: at fit the page is exactly the stage's usable
        // width, and a rounded-up pixel adds a horizontal scrollbar.
        const dispW = Math.max(1, Math.floor(slot.naturalW * scale))
        const dispH = Math.max(1, Math.floor(slot.naturalH * scale))
        slot.frame.style.width = `${dispW}px`
        slot.frame.style.minWidth = `${dispW}px`
        slot.frame.style.maxWidth = 'none'
        slot.frame.style.height = `${dispH}px`
        if (!slot.painted || slot.paintW <= 0) {
          writeDocZoom(slot.frame, scale)
          continue
        }
        const css = dispW / slot.paintW
        slot.pageEl.style.width = `${slot.paintW}px`
        slot.pageEl.style.height = `${slot.paintH}px`
        slot.pageEl.dataset.chromeSubject = 'true'
        slot.pageEl.style.transform = Math.abs(css - 1) < 0.002 ? 'none' : `scale(${css})`
        slot.pageEl.style.transformOrigin = 'top left'
        slot.frame.dataset.cssScale = String(css)
        writeDocZoom(slot.frame, css)
      }
    }

    const cancelSlotRender = (slot: PageSlot): void => {
      if (slot.renderTask) {
        try {
          slot.renderTask.cancel()
        } catch {
          /* ignore */
        }
        slot.renderTask = null
      }
    }

    /**
     * Paint one page. Canvas is shown as soon as it is ready; text layer
     * (for selection) fills in asynchronously so first paint is not blocked.
     */
    const paintSlot = async (slot: PageSlot, force: boolean): Promise<void> => {
      if (cancelled || !pdfjs || !doc) return
      if (slot.painted && !force) return

      cancelSlotRender(slot)
      const page = slot.page ?? (await doc.getPage(slot.pageNum))
      if (cancelled) return
      slot.page = page

      const base = page.getViewport({ scale: 1 })
      // Page-specific 100% size — a PDF may mix portrait and landscape pages.
      slot.naturalW = base.width * PDF_TO_CSS_UNITS
      slot.naturalH = base.height * PDF_TO_CSS_UNITS
      // Correct the placeholder box now, before the (async) raster lands.
      slot.frame.style.width = `${Math.floor(slot.naturalW * scaleRef.current)}px`
      slot.frame.style.minWidth = slot.frame.style.width
      slot.frame.style.height = `${Math.floor(slot.naturalH * scaleRef.current)}px`
      const scale = scaleForWidth(base.width, slot.naturalW * scaleRef.current)
      const viewport = page.getViewport({ scale })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)

      slot.paintW = viewport.width
      slot.paintH = viewport.height
      slot.paintScale = scale

      // Drop placeholder aspect-ratio once we know real metrics.
      slot.frame.style.aspectRatio = ''
      slot.frame.style.maxWidth = 'none'

      // Absolute paint layer — must not participate in frame flow height.
      slot.pageEl.style.position = 'absolute'
      slot.pageEl.style.top = '0'
      slot.pageEl.style.left = '0'
      slot.pageEl.style.width = `${viewport.width}px`
      slot.pageEl.style.height = `${viewport.height}px`
      slot.pageEl.style.transform = 'none'
      slot.pageEl.style.transformOrigin = 'top left'
      slot.pageEl.style.setProperty('--scale-factor', String(viewport.scale))
      slot.pageEl.style.setProperty('--user-unit', '1')

      slot.canvas.width = Math.floor(viewport.width * dpr)
      slot.canvas.height = Math.floor(viewport.height * dpr)
      slot.canvas.style.width = `${viewport.width}px`
      slot.canvas.style.height = `${viewport.height}px`

      slot.textLayer.innerHTML = ''

      const transform = dpr !== 1 ? ([dpr, 0, 0, dpr, 0, 0] as number[]) : undefined
      const task = page.render({
        canvas: slot.canvas,
        viewport,
        transform,
        background: '#ffffff'
      }) as unknown as RenderTask
      slot.renderTask = task
      try {
        await task.promise
      } catch (err) {
        // Cancelled mid-render is expected when quality pass supersedes.
        if ((err as { name?: string })?.name === 'RenderingCancelledException') return
        throw err
      }
      if (cancelled || slot.renderTask !== task) return
      slot.renderTask = null

      // Visible immediately — do not wait for text extraction.
      slot.painted = true
      applyCssFit()
      applySelectionChrome()

      // Selection hit-boxes: background; failures leave canvas readable.
      void (async () => {
        try {
          const textContent = await page.getTextContent()
          if (cancelled || slot.renderTask) return
          slot.textLayer.innerHTML = ''
          const textLayer = new pdfjs!.TextLayer({
            textContentSource: textContent,
            container: slot.textLayer,
            viewport
          })
          await textLayer.render()
          if (cancelled) return
          annotateTextLayer(slot.textLayer, slot.pageNum)
          applySelectionChrome()
        } catch {
          // Text layer is best-effort.
        }
      })()
    }

    const makeSlot = (n: number, naturalW: number, naturalH: number): PageSlot => {
      const frame = document.createElement('div')
      frame.className = 'pdf-page-frame'
      frame.dataset.pageNumber = String(n)
      // Lightweight placeholder until paint. Explicit size so unpainted slots
      // reserve space and do not collapse under absolute-positioned siblings.
      const scale = scaleRef.current
      frame.style.width = `${Math.floor(naturalW * scale)}px`
      frame.style.minWidth = `${Math.floor(naturalW * scale)}px`
      frame.style.maxWidth = 'none'
      frame.style.height = `${Math.floor(naturalH * scale)}px`

      const pageEl = document.createElement('div')
      pageEl.className = 'pdf-page pdf-pick-page'
      pageEl.dataset.pageNumber = String(n)
      pageEl.style.position = 'absolute'
      pageEl.style.top = '0'
      pageEl.style.left = '0'

      const canvas = document.createElement('canvas')
      canvas.className = 'pdf-page-canvas'

      const textLayer = document.createElement('div')
      textLayer.className = 'textLayer'

      pageEl.appendChild(canvas)
      pageEl.appendChild(textLayer)
      frame.appendChild(pageEl)

      return {
        pageNum: n,
        frame,
        pageEl,
        canvas,
        textLayer,
        naturalW,
        naturalH,
        paintW: 0,
        paintH: 0,
        paintScale: 0,
        page: null,
        renderTask: null,
        painted: false
      }
    }

    /**
     * Progressive mount:
     *  1) paint page 1 as soon as possible
     *  2) append remaining placeholders in idle chunks (no 485-node sync loop)
     *  3) IntersectionObserver paints the rest on demand
     */
    const mountSlots = async (pdf: PdfDocument): Promise<void> => {
      host.replaceChildren(track)
      track.replaceChildren()
      trackRef.current = track
      slots = []
      const total = pdf.numPages
      if (total <= 0) return

      // Page 1 sets the document's 100% size — don't touch every page up front.
      let naturalW = 612 * PDF_TO_CSS_UNITS
      let naturalH = 792 * PDF_TO_CSS_UNITS
      try {
        const p1 = await pdf.getPage(1)
        if (cancelled) return
        const v = p1.getViewport({ scale: 1 })
        if (v.width > 0) {
          naturalW = v.width * PDF_TO_CSS_UNITS
          naturalH = v.height * PDF_TO_CSS_UNITS
        }
      } catch {
        // keep default
      }
      naturalPageW = naturalW

      // Paint straight at the fit scale. Publishing naturalWidth to the zoom
      // hook would land a frame later, and page 1 would raster twice.
      if (atFitRef.current) {
        scaleRef.current = computeFitScale(stageUsableWidth(host), naturalW)
      }
      setNaturalWidth(naturalW)
      paintedTargetW = targetPaintWidth()

      // Page 1 immediately.
      const first = makeSlot(1, naturalW, naturalH)
      track.appendChild(first.frame)
      slots.push(first)
      await paintSlot(first, false)
      if (cancelled) return

      // Neighbour page(s) after page 1 — await so frame heights settle in order
      // (parallel paint used to leave transform/layout races → overlapping pages).
      const eagerEnd = Math.min(EAGER_PAGES, total)
      for (let n = 2; n <= eagerEnd; n++) {
        if (cancelled) return
        const slot = makeSlot(n, naturalW, naturalH)
        track.appendChild(slot.frame)
        slots.push(slot)
        await paintSlot(slot, false)
      }

      const observeUnpainted = (): void => {
        if (cancelled) return
        if (typeof IntersectionObserver === 'undefined') {
          for (const slot of slots) {
            if (!slot.painted) void paintSlot(slot, false)
          }
          return
        }
        if (!io) {
          io = new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue
                const num = Number((entry.target as HTMLElement).dataset.pageNumber)
                const slot = slots.find((s) => s.pageNum === num)
                if (!slot || slot.painted) continue
                void paintSlot(slot, false).then(() => {
                  if (cancelled) return
                  io?.unobserve(slot.frame)
                })
              }
            },
            { root: host, rootMargin: '120% 0px', threshold: 0.01 }
          )
        }
        for (const slot of slots) {
          if (!slot.painted) io.observe(slot.frame)
        }
      }

      observeUnpainted()

      // Remaining placeholders in idle chunks so open never blocks on DOM for 400+ pages.
      if (total <= eagerEnd) return
      let next = eagerEnd + 1
      const appendChunk = (): void => {
        if (cancelled || next > total) return
        const frag = document.createDocumentFragment()
        const batch: PageSlot[] = []
        const end = Math.min(total, next + PLACEHOLDER_CHUNK - 1)
        for (let n = next; n <= end; n++) {
          const slot = makeSlot(n, naturalW, naturalH)
          frag.appendChild(slot.frame)
          batch.push(slot)
        }
        track.appendChild(frag)
        slots.push(...batch)
        next = end + 1
        for (const slot of batch) io?.observe(slot.frame)
        if (next <= total) {
          if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => appendChunk(), { timeout: 120 })
          } else {
            setTimeout(appendChunk, 0)
          }
        }
      }
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => appendChunk(), { timeout: 80 })
      } else {
        setTimeout(appendChunk, 0)
      }
    }

    /**
     * After zoom/resize settles, re-paint only if the CSS upscale drifted a lot
     * (avoids blurry pages). Still one shot — never per-frame.
     */
    const scheduleQualityRepaint = (): void => {
      if (qualityTimer) clearTimeout(qualityTimer)
      qualityTimer = setTimeout(() => {
        qualityTimer = null
        if (cancelled || qualityRunning || !doc || !pdfjs) return
        // Skip heavy re-render while window/column drag is live — CSS fit only.
        if (document.documentElement.dataset.resizing === 'true') {
          applyCssFit()
          return
        }
        // Compare raster targets, not pane widths: past the paint budget the
        // zoom can keep growing without changing a single painted pixel.
        const w = targetPaintWidth()
        if (w < 80 || paintedTargetW < 80) return
        const ratio = Math.abs(w - paintedTargetW) / paintedTargetW
        if (ratio < QUALITY_WIDTH_RATIO) {
          // Still just a CSS scale — sharp enough.
          applyCssFit()
          return
        }

        qualityRunning = true
        const scrollRatio =
          host.scrollHeight > 0
            ? host.scrollTop / Math.max(1, host.scrollHeight - host.clientHeight)
            : 0

        void (async () => {
          try {
            // Prefer visible + near-visible slots; others wait for IO again.
            const hostRect = host.getBoundingClientRect()
            const priority = slots.filter((s) => {
              const r = s.frame.getBoundingClientRect()
              return r.bottom > hostRect.top - 400 && r.top < hostRect.bottom + 400
            })
            const rest = slots.filter((s) => !priority.includes(s))
            const order = [...priority, ...rest]

            paintedTargetW = w
            for (const slot of order) {
              if (cancelled) return
              // Only re-paint already painted pages; unpainted stay lazy.
              if (!slot.painted) continue
              await paintSlot(slot, true)
            }
            applyCssFit()
            requestAnimationFrame(() => {
              if (cancelled) return
              const maxScroll = Math.max(0, host.scrollHeight - host.clientHeight)
              host.scrollTop = maxScroll * Math.min(1, Math.max(0, scrollRatio))
              applySelectionChrome()
            })
          } catch (err) {
            if (!cancelled) console.warn('[pdf] quality repaint', err)
          } finally {
            qualityRunning = false
          }
        })()
      }, QUALITY_IDLE_MS)
    }

    setError(null)
    setPageTotal(0)

    void (async () => {
      try {
        if (isOfficeLockFile(path)) throw new Error(OFFICE_LOCK_FILE_MESSAGE)

        pdfjs = await getPdfJs()
        if (cancelled) return

        const assets = pdfAssetBase()
        const url = pdfUrlForPath(path, revision)

        const open = async (withCmaps: boolean) => {
          const task = pdfjs!.getDocument({
            url,
            ...(withCmaps
              ? {
                  cMapUrl: `${assets}cmaps/`,
                  cMapPacked: true,
                  standardFontDataUrl: `${assets}standard_fonts/`
                }
              : {}),
            useSystemFonts: true,
            enableHWA: false,
            // Prefer range/stream so page 1 can paint before the whole file is in.
            disableAutoFetch: true,
            disableStream: false
          })
          loadingTask = task
          return task.promise
        }

        try {
          doc = await open(true)
        } catch (firstErr) {
          console.warn('[pdf] open with cMaps failed, retrying without', firstErr)
          if (cancelled) return
          doc = await open(false)
        }
        if (cancelled || !doc) return

        // Swap only when the new document is ready — keep the previous paint
        // on screen during agent rewrites (no blank flash).
        setPageTotal(doc.numPages)
        await mountSlots(doc)
        if (cancelled) return
        onReady?.()

        // Layout follows the zoom hook (it owns the stage ResizeObserver);
        // this component only owns raster quality. Reconcile once here: the
        // hook may have settled on a fit scale while pages were still mounting.
        applyCssFitRef.current = applyCssFit
        scheduleQualityRef.current = scheduleQualityRepaint
        applyCssFit()

        // Column/window resize end: one sharp fit (+ quality if needed).
        const onResizeEnd = (): void => {
          if (cancelled) return
          applyCssFit()
          scheduleQualityRepaint()
        }
        window.addEventListener('vav:resize-end', onResizeEnd)
        ;(host as HTMLElement & { __pdfResizeEnd?: () => void }).__pdfResizeEnd = onResizeEnd
      } catch (err) {
        if (!cancelled) {
          console.error('[pdf]', err)
          setError((err as Error).message || t('preview.loadFailed'))
          onReady?.()
        }
      }
    })()

    return () => {
      cancelled = true
      if (qualityTimer) clearTimeout(qualityTimer)
      io?.disconnect()
      for (const slot of slots) cancelSlotRender(slot)
      applyCssFitRef.current = null
      scheduleQualityRef.current = null
      const onEnd = (host as HTMLElement & { __pdfResizeEnd?: () => void }).__pdfResizeEnd
      if (onEnd) {
        window.removeEventListener('vav:resize-end', onEnd)
        delete (host as HTMLElement & { __pdfResizeEnd?: () => void }).__pdfResizeEnd
      }
      try {
        void loadingTask?.destroy()
      } catch {
        /* ignore */
      }
      try {
        void doc?.cleanup()
      } catch {
        /* ignore */
      }
    }
    // onReady is stable enough for open; omit from deps to avoid reload loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, revision, t])

  // A different file always opens fitted; an agent rewrite keeps the zoom.
  useEffect(() => {
    setNaturalWidth(0)
    zoom.fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Pick + hover
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const clearHover = (): void => {
      host.querySelectorAll('.textLayer span.hovered, .pdf-page.hovered').forEach((n) => {
        n.classList.remove('hovered')
      })
    }

    const setLineHover = (lineId: string | null): void => {
      clearHover()
      if (!lineId) return
      host
        .querySelectorAll(`.textLayer span[data-line-id="${CSS.escape(lineId)}"]`)
        .forEach((n) => n.classList.add('hovered'))
    }

    const onMove = (event: MouseEvent): void => {
      if (!selectingRef.current) {
        clearHover()
        return
      }
      const target = event.target as HTMLElement | null
      if (!target || !host.contains(target)) {
        clearHover()
        return
      }
      const span = target.closest('.textLayer span') as HTMLElement | null
      if (span?.dataset.lineId && span.textContent?.trim()) {
        setLineHover(span.dataset.lineId)
        return
      }
      clearHover()
      const pageEl = target.closest('.pdf-page') as HTMLElement | null
      pageEl?.classList.add('hovered')
    }

    const onLeave = (): void => clearHover()

    const onDown = (event: MouseEvent): void => {
      if (!selectingRef.current || event.button !== 0) return
      const target = event.target as HTMLElement | null
      if (!target || !host.contains(target)) return

      const span = target.closest('.textLayer span') as HTMLElement | null
      const pageEl = target.closest('.pdf-page') as HTMLElement | null
      if (!pageEl) return

      // Do not preventDefault — PDF text copy must still work.
      event.stopPropagation()

      const win = host.ownerDocument?.defaultView ?? window
      const spanSnapshot = span
      const pageSnapshot = pageEl
      scheduleClickPick(
        { button: event.button, clientX: event.clientX, clientY: event.clientY },
        () => {
          host.querySelectorAll('.textLayer span.selected, .pdf-page.selected').forEach((n) => {
            n.classList.remove('selected')
          })

          if (spanSnapshot?.textContent?.trim()) {
            const line = collectLineGroup(spanSnapshot)
            host
              .querySelectorAll(`.textLayer span[data-line-id="${CSS.escape(line.id)}"]`)
              .forEach((n) => n.classList.add('selected'))
            onPickRef.current(
              {
                id: line.id,
                kind: 'paragraph',
                text: line.text.slice(0, 8000),
                label: line.text.slice(0, 64) || line.id,
                startLine: 0,
                endLine: 0
              },
              event
            )
            return
          }

          const pageNum = pageSnapshot.dataset.pageNumber ?? '?'
          const id = `pdf-page-${pageNum}`
          const text = Array.from(pageSnapshot.querySelectorAll('.textLayer span'))
            .map((s) => s.textContent ?? '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
          pageSnapshot.classList.add('selected')
          onPickRef.current(
            {
              id,
              kind: 'page',
              text: text.slice(0, 8000),
              label: `Page ${pageNum}`,
              startLine: 0,
              endLine: 0
            },
            event
          )
        },
        { win }
      )
    }

    host.addEventListener('mousemove', onMove, true)
    host.addEventListener('mouseleave', onLeave, true)
    host.addEventListener('mousedown', onDown, true)
    return () => {
      host.removeEventListener('mousemove', onMove, true)
      host.removeEventListener('mouseleave', onLeave, true)
      host.removeEventListener('mousedown', onDown, true)
      clearHover()
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const set = new Set(selectedIds)
    host.querySelectorAll<HTMLElement>('.textLayer span[data-line-id]').forEach((el) => {
      const lineId = el.dataset.lineId
      el.classList.toggle('selected', !!lineId && set.has(lineId))
    })
    host.querySelectorAll<HTMLElement>('.pdf-page').forEach((el) => {
      const id = `pdf-page-${el.dataset.pageNumber ?? ''}`
      el.classList.toggle('selected', set.has(id))
    })
  }, [selectedIds])

  return (
    <div className={`office-native-root pdf-root${selecting ? ' selecting' : ''}`}>
      {error && (
        <div className="office-native-status error">
          <strong>{t('preview.loadFailed')}</strong>
          <div className="muted tiny">{error}</div>
        </div>
      )}
      <div ref={hostRef} className="pdf-pages-host" />
      <PagePager
        current={pageIndex.current}
        total={pageIndex.total}
        onPrev={pageIndex.prev}
        onNext={pageIndex.next}
        disabled={!!error}
      />
      <DocZoomControls
        scale={zoom.scale}
        atFit={zoom.atFit}
        onZoomIn={() => zoom.zoomBy(DOC_ZOOM_STEP)}
        onZoomOut={() => zoom.zoomBy(1 / DOC_ZOOM_STEP)}
        onFit={zoom.actualSize}
        disabled={!!error || pageTotal <= 0}
      />
    </div>
  )
}

function annotateTextLayer(layer: HTMLElement, pageNum: number): void {
  const spans = Array.from(layer.querySelectorAll('span')) as HTMLElement[]
  type Row = { top: number; spans: HTMLElement[] }
  const rows: Row[] = []
  for (const span of spans) {
    const y = Math.round(span.offsetTop)
    const row = rows.find((r) => Math.abs(r.top - y) <= 3)
    if (row) row.spans.push(span)
    else rows.push({ top: y, spans: [span] })
  }
  rows.forEach((row, li) => {
    const lineId = `pdf-p${pageNum}-L${li}`
    for (const span of row.spans) {
      span.dataset.lineId = lineId
      span.dataset.blockId = lineId
    }
  })
}

function collectLineGroup(span: HTMLElement): { text: string; id: string } {
  const lineId = span.dataset.lineId || span.dataset.blockId || 'pdf-line'
  const layer = span.closest('.textLayer')
  const group = layer
    ? (Array.from(
        layer.querySelectorAll(`span[data-line-id="${CSS.escape(lineId)}"]`)
      ) as HTMLElement[])
    : [span]
  const text = group
    .map((s) => s.textContent ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return { text, id: lineId }
}
