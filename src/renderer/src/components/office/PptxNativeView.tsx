/**
 * PPTX: parse OOXML → HTML/SVG via @aiden0z/pptx-renderer.
 * Agent pick reuses shared attachDomPick (same path as DOCX).
 *
 * Fit-to-width is CSS-only (like DocxNativeView). The library's fitMode
 * "contain" re-renders every container resize (agent panel toggle → clear
 * innerHTML → white flash). We open with fitMode "none" and scale slides
 * ourselves so resize only updates transforms.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PptxViewer,
  RECOMMENDED_ZIP_LIMITS
} from '@aiden0z/pptx-renderer'
import type { PreviewBlock } from '@shared/previewBlock'
import { loadFileBuffer } from '../../lib/officeBinary'
import {
  attachDomPick,
  syncSelectedClasses,
  updateDomPick
} from './pickFromDom'
import { useT } from '../../i18n/useT'
import { PagePager } from './PagePager'
import { DocZoomControls, DOC_ZOOM_STEP } from './DocZoomControls'
import { useDocZoom } from './useDocZoom'
import { writeDocZoom } from '../../lib/selectionChrome'

/** Shape / picture frames annotated for pick. */
const PPTX_SHAPE_SELECTOR = '.pptx-shape-pick'

/**
 * Apply width-fit scale to already-mounted slides without re-rendering.
 * Library DOM: [data-slide-index] > outer(size) > inner(transform:scale).
 */
function fitPptxSlides(
  host: HTMLElement,
  naturalW: number,
  naturalH: number,
  scale: number,
  force = false
): void {
  if (!(naturalW > 0) || !(naturalH > 0)) return
  const prev = Number(host.dataset.pptxScale || 0)
  if (!force && prev && Math.abs(prev - scale) < 0.008) return
  host.dataset.pptxScale = String(scale)

  // Floor, never round up: at fit a slide is exactly the stage's usable width,
  // and one extra pixel adds a horizontal scrollbar.
  const dw = Math.floor(naturalW * scale)
  const dh = Math.floor(naturalH * scale)
  host.querySelectorAll<HTMLElement>('[data-slide-index]').forEach((slot) => {
    const outer = slot.firstElementChild as HTMLElement | null
    if (!outer) return
    outer.style.width = `${dw}px`
    outer.style.minWidth = `${dw}px`
    outer.style.maxWidth = 'none'
    outer.style.height = `${dh}px`
    const inner = outer.firstElementChild as HTMLElement | null
    outer.dataset.chromeFrame = 'true'
    writeDocZoom(outer, scale)
    if (inner) {
      // Library already uses transform:scale; origin is typically top-left.
      inner.dataset.chromeSubject = 'true'
      inner.style.transformOrigin = inner.style.transformOrigin || 'top left'
      inner.style.transform = `scale(${scale})`
    }
  })
}

export function PptxNativeView({
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
  const stageRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PptxViewer | null>(null)
  const disposePickRef = useRef<(() => void) | null>(null)
  const naturalSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })
  const scaleRef = useRef(1)
  const [naturalWidth, setNaturalWidth] = useState(0)
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const selectingRef = useRef(selecting)
  selectingRef.current = selecting
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  /** 1-based slide index for the floating pager. */
  const [slideCurrent, setSlideCurrent] = useState(1)
  const [slideTotal, setSlideTotal] = useState(0)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  const applyScale = useCallback((scale: number): void => {
    scaleRef.current = scale
    const { w, h } = naturalSizeRef.current
    if (hostRef.current && w > 0) fitPptxSlides(hostRef.current, w, h, scale)
  }, [])

  const zoom = useDocZoom({
    stageRef,
    contentRef: hostRef,
    naturalWidth,
    apply: applyScale,
    enabled: ready && !error
  })

  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    if (!host) return

    setLoading(true)
    setReady(false)
    setError(null)
    setSlideTotal(0)
    setSlideCurrent(1)
    // Defer clearing until the next buffer is in hand so agent rewrites don't
    // blank the stage while bytes are still loading.
    naturalSizeRef.current = { w: 0, h: 0 }
    setNaturalWidth(0)
    viewerRef.current = null
    disposePickRef.current?.()
    disposePickRef.current = null

    const ac = new AbortController()

    const pick = (block: PreviewBlock, event: MouseEvent): void => {
      onPickRef.current(block, event)
    }

    /** Re-assert the live scale on slides the library just window-mounted. */
    const applyFit = (force = false): void => {
      const { w, h } = naturalSizeRef.current
      if (hostRef.current && w > 0) {
        fitPptxSlides(hostRef.current, w, h, scaleRef.current, force)
      }
    }

    /** Re-tag shapes/pictures + restore selection chrome (windowed remount safe). */
    const reannotate = (root: HTMLElement): void => {
      root.querySelectorAll<HTMLElement>('[data-slide-index]').forEach((el) => {
        const idx = Number(el.getAttribute('data-slide-index'))
        if (!Number.isFinite(idx)) return
        tagSlideFrame(el, idx)
        annotateShapeTargets(el, idx)
      })
      syncSelectedClasses(root, selectedIdsRef.current)
      syncSlideSelectedClasses(root, selectedIdsRef.current)
      applyFit(true)
    }

    const resolveSlideFallback = (raw: HTMLElement, root: HTMLElement): HTMLElement | null => {
      // Never fall back to the page when the pointer is on a shape/picture.
      if (raw.closest(PPTX_SHAPE_SELECTOR)) return null
      // Walk up: if any ancestor is a pickable shape we failed to class, still skip slide.
      if (findShapeFrameFromTarget(raw, root)) return null

      const slide =
        (raw.closest('[data-pptx-slide-index]') as HTMLElement | null) ??
        (raw.closest('[data-slide-index]') as HTMLElement | null)
      if (!slide || !root.contains(slide)) return null
      if (!slide.dataset.blockId) {
        const idx = Number(
          slide.dataset.pptxSlideIndex ?? slide.getAttribute('data-slide-index') ?? -1
        )
        if (Number.isFinite(idx) && idx >= 0) {
          slide.dataset.blockId = `pptx-slide-${idx}`
          slide.setAttribute('data-block-id', slide.dataset.blockId)
          slide.dataset.pickKind = 'slide'
        }
      }
      return slide.dataset.blockId ? slide : null
    }

    void (async () => {
      try {
        const buf = await loadFileBuffer(path, revision)
        if (cancelled || !hostRef.current) return

        host.innerHTML = ''
        host.dataset.pptxScale = ''

        // IntersectionObserver root must be the scrollport (outer stage), not
        // the inner measure host — otherwise lazy windowing / slide tracking
        // mis-measures visibility when the host doesn't scroll itself.
        const scrollRoot =
          stageRef.current ??
          (hostRef.current.parentElement as HTMLElement | null) ??
          hostRef.current

        const viewer = await PptxViewer.open(buf, hostRef.current, {
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          renderMode: 'list',
          // "contain" re-renders (clears DOM) on every width change → white flash
          // when the agent panel opens/closes. Fit with CSS instead.
          fitMode: 'none',
          lazySlides: true,
          lazyMedia: true,
          scrollContainer: scrollRoot,
          listOptions: {
            windowed: true,
            initialSlides: 4,
            batchSize: 4,
            overscanViewport: 1.5,
            showSlideLabels: true
          },
          signal: ac.signal,
          pdfjs: false,
          onSlideRendered: (index, element) => {
            tagSlideFrame(element, index)
            annotateShapeTargets(element, index)
            // Newly window-mounted slides still at 1× — re-apply current fit.
            applyFit(true)
            if (hostRef.current) {
              syncSelectedClasses(hostRef.current, selectedIdsRef.current)
              syncSlideSelectedClasses(hostRef.current, selectedIdsRef.current)
            }
          },
          // Library tracks the active slide on scroll + goToSlide (0-based).
          onSlideChange: (index) => {
            if (cancelled) return
            setSlideCurrent(Math.max(1, index + 1))
          }
        })
        if (cancelled) {
          try {
            hostRef.current && (hostRef.current.innerHTML = '')
          } catch {
            // ignore
          }
          return
        }
        viewerRef.current = viewer
        const nw = viewer.slideWidth || 960
        const nh = viewer.slideHeight || 540
        naturalSizeRef.current = { w: nw, h: nh }
        const count = viewer.slideCount || 0
        setSlideTotal(count)
        setSlideCurrent(Math.max(1, (viewer.currentSlideIndex ?? 0) + 1))
        reannotate(hostRef.current)
        // Publish the natural slide width — the zoom hook fits from here on.
        setNaturalWidth(nw)
        applyFit(true)

        disposePickRef.current = attachDomPick(hostRef.current, {
          selecting: selectingRef.current,
          selectedIds: selectedIdsRef.current,
          onPick: pick,
          selector: PPTX_SHAPE_SELECTOR,
          // Ids are assigned in annotateShapeTargets (stable geometry keys).
          idPrefix: 'pptx-el',
          beforeDown: reannotate,
          resolveFallback: resolveSlideFallback
        })

        setLoading(false)
        setReady(true)
        onReady?.()
      } catch (err) {
        if (cancelled || ac.signal.aborted) return
        if ((err as Error)?.name === 'AbortError') return
        const msg = (err as Error)?.message || String(err) || t('preview.loadFailed')
        console.error('[pptx]', err)
        setError(msg)
        setLoading(false)
        setReady(false)
        // Leave StructuredDocView up — a failed native paint is not "ready".
      }
    })()

    return () => {
      cancelled = true
      ac.abort()
      disposePickRef.current?.()
      disposePickRef.current = null
      viewerRef.current = null
      if (hostRef.current) hostRef.current.innerHTML = ''
    }
  }, [path, revision, t])

  // A different deck always opens fitted; an agent rewrite keeps the zoom.
  useEffect(() => {
    setNaturalWidth(0)
    zoom.fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => {
    if (!ready) return
    const host = hostRef.current
    if (!host) return
    updateDomPick(host, {
      selecting,
      selectedIds,
      onPick: (block, event) => onPickRef.current(block, event)
    })
    syncSlideSelectedClasses(host, selectedIds)
  }, [selecting, selectedIds, ready])

  return (
    <div
      className={`office-native-root pptx-root${selecting ? ' selecting' : ''}${loading ? ' is-loading' : ''}`}
    >
      {loading && <div className="office-native-status muted">{t('common.loading')}</div>}
      {error && (
        <div className="office-native-status error">
          <strong>{t('preview.loadFailed')}</strong>
          <div className="muted tiny">{error}</div>
        </div>
      )}
      {/*
        Outer stage: scroll + gutters. Inner host: library mount + CSS fit measure.
        fitMode "none" + fitPptxSlides avoids white flash on agent-panel resize.
      */}
      <div
        ref={stageRef}
        className="pptx-pages-host office-doc-stage"
        aria-hidden={!!error}
      >
        <div
          ref={hostRef}
          className="pptx-render-host"
          data-pick-root="true"
        />
      </div>
      <PagePager
        current={slideCurrent}
        total={slideTotal}
        onPrev={() => {
          const v = viewerRef.current
          if (!v) return
          void v.goToSlide(Math.max(0, v.currentSlideIndex - 1), {
            behavior: 'auto',
            block: 'start'
          })
        }}
        onNext={() => {
          const v = viewerRef.current
          if (!v) return
          void v.goToSlide(Math.min(v.slideCount - 1, v.currentSlideIndex + 1), {
            behavior: 'auto',
            block: 'start'
          })
        }}
        disabled={!ready || !!error}
      />
      <DocZoomControls
        scale={zoom.scale}
        atFit={zoom.atFit}
        onZoomIn={() => zoom.zoomBy(DOC_ZOOM_STEP)}
        onZoomOut={() => zoom.zoomBy(1 / DOC_ZOOM_STEP)}
        onFit={zoom.actualSize}
        disabled={!ready || !!error}
      />
    </div>
  )
}

function syncSlideSelectedClasses(host: HTMLElement, selectedIds: string[]): void {
  const set = new Set(selectedIds)
  const hasShapePick = selectedIds.some(
    (s) => s.startsWith('pptx-el-') || s.includes('-el-') || s.includes('-img-')
  )
  host.querySelectorAll<HTMLElement>('[data-pptx-slide-index]').forEach((el) => {
    const id = el.dataset.blockId || `pptx-slide-${el.dataset.pptxSlideIndex ?? ''}`
    // Whole-slide chrome only when a slide id is selected and no shape is.
    el.classList.toggle('selected', set.has(id) && !hasShapePick)
  })
}

function tagSlideFrame(element: HTMLElement, index: number): void {
  const frame =
    element.matches?.('[data-slide-index]')
      ? element
      : (element.closest('[data-slide-index]') as HTMLElement | null) ?? element
  frame.dataset.pptxSlideIndex = String(index)
  frame.classList.add('pptx-visual-slide')
  frame.dataset.blockId = `pptx-slide-${index}`
  frame.setAttribute('data-block-id', `pptx-slide-${index}`)
  frame.dataset.pickKind = 'slide'
}

/**
 * Tag outer absolute frames: text shapes and pictures.
 * Stable data-block-id from geometry so windowed remount keeps selection.
 */
function annotateShapeTargets(slideRoot: HTMLElement, slideIndex: number): void {
  const slide =
    slideRoot.matches?.('[data-slide-index], [data-pptx-slide-index]')
      ? slideRoot
      : (slideRoot.closest('[data-slide-index], [data-pptx-slide-index]') as HTMLElement | null) ??
        slideRoot

  // Strip previous pick classes only — keep ids if geometry key matches below.
  slide.querySelectorAll<HTMLElement>('.pptx-shape-pick').forEach((el) => {
    el.classList.remove('pptx-shape-pick', 'office-pick-target', 'preview-select-region')
  })

  const candidates = Array.from(slide.querySelectorAll<HTMLElement>('div')).filter((el) => {
    if (el === slide) return false
    if (!isAbsolutelyPositioned(el)) return false
    if (isFullBleedOverlay(el)) return false
    const hasImg = !!el.querySelector('img')
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
    // Text box OR picture frame.
    if (!text && !hasImg) return false
    return true
  })

  // Outermost only — one target per shape/picture.
  const roots = candidates.filter(
    (el) => !candidates.some((other) => other !== el && other.contains(el))
  )

  roots.forEach((el) => {
    const id = stableShapeId(slideIndex, el)
    el.dataset.blockId = id
    el.setAttribute('data-block-id', id)
    el.classList.add('pptx-shape-pick', 'office-pick-target', 'preview-select-region')
    // Image-only shapes: store a pick label for Agent context.
    if (!(el.innerText || '').trim() && el.querySelector('img')) {
      el.dataset.pickKind = 'image'
      el.dataset.pickLabel = 'Image'
    }
  })
}

/** Walk up from click target to find a shape frame even if class was stripped mid-gesture. */
function findShapeFrameFromTarget(raw: HTMLElement, root: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = raw
  while (el && el !== root) {
    if (el.classList.contains('pptx-shape-pick')) return el
    if (
      isAbsolutelyPositioned(el) &&
      !isFullBleedOverlay(el) &&
      (el.querySelector('img') || (el.innerText || '').trim())
    ) {
      // Prefer outermost absolute among walk — continue until parent isn't absolute shape.
      const parentEl: HTMLElement | null = el.parentElement
      if (
        parentEl &&
        isAbsolutelyPositioned(parentEl) &&
        !isFullBleedOverlay(parentEl) &&
        parentEl.contains(el) &&
        (parentEl.querySelector('img') || (parentEl.innerText || '').trim())
      ) {
        el = parentEl
        continue
      }
      return el
    }
    el = el.parentElement
  }
  return null
}

function stableShapeId(slideIndex: number, el: HTMLElement): string {
  const s = el.getAttribute('style') || ''
  const left = (/left\s*:\s*([\d.]+)/i.exec(s)?.[1] ?? '0').replace(/\./g, 'p')
  const top = (/top\s*:\s*([\d.]+)/i.exec(s)?.[1] ?? '0').replace(/\./g, 'p')
  const hasImg = el.querySelector('img') ? 'img' : 'tx'
  const text = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 20)
  const thumb = simpleHash(`${left}|${top}|${hasImg}|${text}`)
  return `pptx-el-${slideIndex}-${hasImg}-${left}x${top}-${thumb}`
}

function simpleHash(input: string): string {
  let h = 0
  for (let i = 0; i < input.length; i++) h = (Math.imul(31, h) + input.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function isAbsolutelyPositioned(el: HTMLElement): boolean {
  const inline = el.getAttribute('style') || ''
  if (/position\s*:\s*absolute/i.test(inline)) return true
  try {
    return getComputedStyle(el).position === 'absolute'
  } catch {
    return false
  }
}

function isFullBleedOverlay(el: HTMLElement): boolean {
  const s = el.getAttribute('style') || ''
  const left0 = /left\s*:\s*0(px|%)?/i.test(s)
  const top0 = /top\s*:\s*0(px|%)?/i.test(s)
  const w100 = /width\s*:\s*100%/i.test(s)
  const h100 = /height\s*:\s*100%/i.test(s)
  return left0 && top0 && w100 && h100
}
