/**
 * PDF.js viewer — performance via virtualization, not product page caps:
 *  - All pages get light slots; paint only when near viewport (IO)
 *  - Resize: CSS transform fit only (no page.render per frame)
 *  - Idle + large scale drift: optional quality re-paint of painted pages
 */

import { useEffect, useRef, useState } from 'react'
import type { PreviewBlock } from '@shared/previewBlock'
import { docMeasureMinPx, docMeasurePx, stableContentWidth } from '../../lib/docMeasure'
import { isOfficeLockFile, OFFICE_LOCK_FILE_MESSAGE } from '@shared/officeLock'
import { scheduleClickPick } from '../../lib/clickPick'
import { useT } from '../../i18n/useT'
import { PagePager } from './PagePager'
import { useDocumentPageIndex } from './useDocumentPageIndex'

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

/** CSS fit updates are cheap — rAF-throttle only. */
const FIT_RAF_MIN_DELTA_PX = 2
/** Quality re-paint only after resize fully settles. */
const QUALITY_IDLE_MS = 520
/** Re-paint only if fit width drifted this much vs last canvas paint. */
const QUALITY_WIDTH_RATIO = 0.12
/** First paint: only page 1 (canvas). Neighbours fill in after first frame. */
const EAGER_PAGES = 2
/**
 * Soft paint budget in CSS pixels (not a product page-size cap).
 * Previously 960 left wide windows with tiny, upscaled pages; 2000 fills
 * typical large panes while avoiding multi‑GB bitmaps on 5K displays.
 */
const PAINT_WIDTH_BUDGET = 2000
/** How many lightweight page frames to insert per idle chunk (large books). */
const PLACEHOLDER_CHUNK = 40

function scaleForWidth(pageWidthPt: number, cssTarget: number): number {
  // Paint at the stable reading width (not the live pane) so resize never
  // re-rasters and narrow windows scroll instead of shrinking the page.
  const target = Math.max(160, Math.min(cssTarget, PAINT_WIDTH_BUDGET))
  // A4 ≈ 595pt → scale ≈ 1.45 at 860 CSS px.
  return Math.max(0.45, Math.min(4, target / pageWidthPt))
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
  /** CSS pixel size of last canvas paint (pre fit-scale). */
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
  const [error, setError] = useState<string | null>(null)
  const [pageTotal, setPageTotal] = useState(0)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const selectingRef = useRef(selecting)
  selectingRef.current = selecting
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds

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
    /** Fit width (measure-capped) used for the last full canvas paint. */
    let paintHostWidth = 0
    let fitRaf = 0
    let qualityTimer: ReturnType<typeof setTimeout> | null = null
    let qualityRunning = false
    let io: IntersectionObserver | null = null
    const host = hostRef.current
    if (!host) return

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

    /** Stable reading width — independent of the live pane. */
    const usableWidth = (): number => {
      // Prefer first painted page's natural CSS width when known; else the max measure.
      const natural =
        slots.find((s) => s.paintW > 0)?.paintW ||
        docMeasurePx(host)
      return Math.max(
        160,
        stableContentWidth(natural, docMeasureMinPx(host), docMeasurePx(host))
      )
    }

    /**
     * Keep frames at the stable painted size. Resize of the pane must not
     * re-scale pages — the stage scrolls horizontally when narrower.
     */
    const applyCssFit = (): void => {
      for (const slot of slots) {
        if (!slot.painted || slot.paintW <= 0 || slot.paintH <= 0) continue
        const visW = Math.max(1, slot.paintW)
        const visH = Math.max(1, slot.paintH)
        slot.frame.style.width = `${visW}px`
        slot.frame.style.minWidth = `${visW}px`
        slot.frame.style.maxWidth = 'none'
        slot.frame.style.height = `${visH}px`
        slot.pageEl.style.width = `${slot.paintW}px`
        slot.pageEl.style.height = `${slot.paintH}px`
        slot.pageEl.style.transform = 'none'
        slot.pageEl.style.transformOrigin = 'top left'
        slot.frame.dataset.cssScale = '1'
      }
    }

    const scheduleCssFit = (): void => {
      if (fitRaf) cancelAnimationFrame(fitRaf)
      fitRaf = requestAnimationFrame(() => {
        fitRaf = 0
        if (!cancelled) applyCssFit()
      })
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

      const usable = usableWidth()
      const base = page.getViewport({ scale: 1 })
      const scale = scaleForWidth(base.width, usable)
      const viewport = page.getViewport({ scale })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)

      slot.paintW = viewport.width
      slot.paintH = viewport.height
      slot.paintScale = scale

      // Drop placeholder aspect-ratio once we know real metrics.
      slot.frame.style.aspectRatio = ''
      slot.frame.style.maxWidth = 'none'
      // Layout size = paint size until applyCssFit (may scale for current host).
      slot.frame.style.width = `${viewport.width}px`
      slot.frame.style.height = `${viewport.height}px`

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

    const makeSlot = (n: number, aspect: number): PageSlot => {
      const frame = document.createElement('div')
      frame.className = 'pdf-page-frame'
      frame.dataset.pageNumber = String(n)
      // Lightweight placeholder until paint (stable measure × real aspect).
      // Explicit height from aspect so unpainted slots still reserve space and
      // do not collapse under absolute-positioned siblings once painted.
      const phW = usableWidth()
      frame.style.width = `${phW}px`
      frame.style.minWidth = `${phW}px`
      frame.style.maxWidth = 'none'
      frame.style.aspectRatio = `1 / ${aspect}`

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
      host.innerHTML = ''
      slots = []
      const total = pdf.numPages
      if (total <= 0) return

      paintHostWidth = usableWidth()

      // Aspect from page 1 only — don't touch every page up front.
      let aspect = 1.294
      try {
        const p1 = await pdf.getPage(1)
        if (cancelled) return
        const v = p1.getViewport({ scale: 1 })
        if (v.width > 0) aspect = v.height / v.width
      } catch {
        // keep default
      }

      // Page 1 immediately.
      const first = makeSlot(1, aspect)
      host.appendChild(first.frame)
      slots.push(first)
      await paintSlot(first, false)
      if (cancelled) return

      // Neighbour page(s) after page 1 — await so frame heights settle in order
      // (parallel paint used to leave transform/layout races → overlapping pages).
      const eagerEnd = Math.min(EAGER_PAGES, total)
      for (let n = 2; n <= eagerEnd; n++) {
        if (cancelled) return
        const slot = makeSlot(n, aspect)
        host.appendChild(slot.frame)
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
          const slot = makeSlot(n, aspect)
          frag.appendChild(slot.frame)
          batch.push(slot)
        }
        host.appendChild(frag)
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
     * After resize settles, re-paint only if CSS scale drifted a lot
     * (avoids blurry upscale). Still one shot — never per-frame.
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
        // Compare fit widths, not pane widths: past the measure the pane can
        // grow without changing a single painted pixel.
        const w = usableWidth()
        if (w < 80 || paintHostWidth < 80) return
        const ratio = Math.abs(w - paintHostWidth) / paintHostWidth
        if (ratio < QUALITY_WIDTH_RATIO) {
          // Still just CSS fit — sharp enough.
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

            paintHostWidth = w
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
        host.innerHTML = ''
        setPageTotal(doc.numPages)
        await mountSlots(doc)
        if (cancelled) return
        onReady?.()

        if (typeof ResizeObserver !== 'undefined') {
          let lastFitW = host.clientWidth
          const ro = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect.width ?? host.clientWidth
            if (!Number.isFinite(w) || w < 80) return
            // Instant CSS fit while dragging (column or window).
            if (Math.abs(w - lastFitW) >= FIT_RAF_MIN_DELTA_PX) {
              lastFitW = w
              scheduleCssFit()
            }
            // Quality re-paint only after settle + large drift (not mid-drag).
            if (document.documentElement.dataset.resizing !== 'true') {
              scheduleQualityRepaint()
            }
          })
          ro.observe(host)
          ;(host as HTMLElement & { __pdfRo?: ResizeObserver }).__pdfRo = ro
        }

        // Column/window resize end: one sharp fit (+ quality if needed).
        const onResizeEnd = (): void => {
          if (cancelled) return
          scheduleCssFit()
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
      if (fitRaf) cancelAnimationFrame(fitRaf)
      if (qualityTimer) clearTimeout(qualityTimer)
      io?.disconnect()
      for (const slot of slots) cancelSlotRender(slot)
      const ro = (host as HTMLElement & { __pdfRo?: ResizeObserver }).__pdfRo
      ro?.disconnect()
      delete (host as HTMLElement & { __pdfRo?: ResizeObserver }).__pdfRo
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
                startLine: 1,
                endLine: 1
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
              startLine: 1,
              endLine: 1
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
