/**
 * Figma-style infinite canvas for the full-bleed diagram views
 * (mind map / mermaid / graphviz / draw.io).
 *
 * - Two-finger trackpad pan (wheel deltaX/deltaY).
 * - Space + left-drag pan (cursor switches to grab/grabbing).
 * - Trackpad pinch, ⌘/Ctrl+wheel, and +/− buttons all zoom anchored to the cursor.
 * - Content is auto-fitted and centred until the first manual pan/zoom.
 *
 * Implementation notes:
 *
 * The view renders its SVG/host inside a wrapper that carries
 * `transform: translate(tx, ty) scale(zoom)`. Pan/zoom are pure transforms
 * (no layout reflow, no scroll-container dependence), so the canvas can move
 * freely in any direction — content is never clipped to the initial viewport.
 *
 * `will-change: transform` is applied *only* while a pan gesture is running.
 * Leaving it on permanently pins the compositor raster to the scale it was
 * promoted at, so zooming in produced a stretched, blurry bitmap instead of
 * re-rasterised vector output.
 *
 * React state is kept out of the gesture loop: the transform is written
 * straight to the element and the (rounded) zoom percentage is committed once
 * per frame, so a wheel burst no longer re-renders the whole diagram per event.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { useT } from '../../i18n/useT'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
const BUTTON_FACTOR = 1.25
/** Auto-fit never upscales past 1:1 — a three-node graph blown up reads as broken. */
const MAX_FIT_ZOOM = 1
/** Breathing room between fitted content and the viewport edge, in screen px. */
const FIT_INSET = 28
/** Cap a single wheel tick so mouse notches (deltaY 100+) don't jump whole scales. */
const MAX_WHEEL_STEP = 1.5
/** Pinch deltas are tiny; mouse-wheel deltas are large. Separate sensitivities. */
const PINCH_SENSITIVITY = 0.014
const WHEEL_ZOOM_SENSITIVITY = 0.005
/** Reveal content even if it never reports a measurable size. */
const REVEAL_FALLBACK_MS = 400

const clamp = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

/** Normalize line/page wheel modes to pixels. */
const wheelPx = (delta: number, mode: number): number =>
  mode === 1 ? delta * 16 : mode === 2 ? delta * 400 : delta

export type CanvasZoom = {
  zoom: number
  /** true while space-pan (or any drag-pan) is active. */
  panning: boolean
  /** Apply to the transform wrapper (the SVG/host parent). */
  contentStyle: CSSProperties
  /** Ref to attach to the transform wrapper (lets the hook paint w/o re-render). */
  wrapperRef: (el: HTMLElement | null) => void
  /** Props to spread on the scroll/viewport container. */
  viewportProps: {
    ref: (el: HTMLElement | null) => void
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
  }
  zoomIn: () => void
  zoomOut: () => void
  /** Re-centre and re-fit; also re-arms auto-fit on content resize. */
  fit: () => void
  /** Alias of {@link fit} — the zoom readout / ⌥click affordance. */
  reset: () => void
  /** Floating controls; render once inside the view root. */
  controls: React.JSX.Element
}

type View = { tx: number; ty: number; zoom: number }

export function useCanvasZoom(): CanvasZoom {
  const t = useT()
  const viewRef = useRef<View>({ tx: 0, ty: 0, zoom: 1 })
  /** Rounded percentage only — panning must not re-render the view. */
  const [zoomPct, setZoomPct] = useState(100)
  const [offFit, setOffFit] = useState(false)
  const [panning, setPanning] = useState(false)
  const spaceHeldRef = useRef(false)
  const hostElRef = useRef<HTMLElement | null>(null)
  const wrapperElRef = useRef<HTMLElement | null>(null)
  /** Auto-fit stays armed until the user pans/zooms by hand. */
  const autoFitRef = useRef(true)
  const fittedRef = useRef<View | null>(null)
  const commitRafRef = useRef<number | null>(null)
  const panHintTimerRef = useRef<number | null>(null)
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null)
  /**
   * Cached viewport box. Reading getBoundingClientRect per wheel event forced a
   * style+layout flush right after we wrote a transform — the layout thrash is
   * what made pinch-zoom feel like it was crawling. Refreshed once per gesture.
   */
  const hostRectRef = useRef<DOMRect | null>(null)
  const lastWheelAtRef = useRef(0)

  const hostRect = useCallback((): DOMRect | null => {
    const el = hostElRef.current
    if (!el) return null
    if (!hostRectRef.current) hostRectRef.current = el.getBoundingClientRect()
    return hostRectRef.current
  }, [])

  /** Paint the transform without a React render (used during pan/zoom). */
  const paint = useCallback((v: View): void => {
    const el = wrapperElRef.current
    if (!el) return
    el.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.zoom})`
  }, [])

  /** Coalesce the readout/state update to one per frame. */
  const commitState = useCallback((): void => {
    if (commitRafRef.current != null) return
    commitRafRef.current = window.requestAnimationFrame(() => {
      commitRafRef.current = null
      const v = viewRef.current
      const pct = Math.round(v.zoom * 100)
      setZoomPct((prev) => (prev === pct ? prev : pct))
      const fitted = fittedRef.current
      const atFit =
        !!fitted &&
        Math.abs(fitted.tx - v.tx) < 0.5 &&
        Math.abs(fitted.ty - v.ty) < 0.5 &&
        Math.abs(fitted.zoom - v.zoom) < 0.001
      setOffFit((prev) => (prev === !atFit ? prev : !atFit))
    })
  }, [])

  const applyView = useCallback(
    (next: View): void => {
      viewRef.current = next
      paint(next)
      commitState()
    },
    [paint, commitState]
  )

  /**
   * Composited-layer hint. On during pan (cheap translate), off for zoom so the
   * SVG re-rasterises at the new scale instead of scaling a stale bitmap.
   */
  const setPanHint = useCallback((on: boolean): void => {
    const el = wrapperElRef.current
    if (panHintTimerRef.current != null) {
      window.clearTimeout(panHintTimerRef.current)
      panHintTimerRef.current = null
    }
    if (!el) return
    el.style.willChange = on ? 'transform' : 'auto'
  }, [])

  /** Turn the pan hint off shortly after a wheel-pan burst stops. */
  const releasePanHintSoon = useCallback((): void => {
    if (panHintTimerRef.current != null) window.clearTimeout(panHintTimerRef.current)
    panHintTimerRef.current = window.setTimeout(() => {
      panHintTimerRef.current = null
      const el = wrapperElRef.current
      if (el) el.style.willChange = 'auto'
    }, 180)
  }, [])

  const markManual = useCallback((): void => {
    autoFitRef.current = false
  }, [])

  /** Centre content in the viewport at the largest scale that fits (≤ 1:1). */
  const fitToViewport = useCallback((): boolean => {
    const host = hostElRef.current
    const wrap = wrapperElRef.current
    if (!host || !wrap) return false
    const vw = host.clientWidth
    const vh = host.clientHeight
    // Layout (unscaled) size — getBoundingClientRect would include our transform.
    const cw = wrap.offsetWidth
    const ch = wrap.offsetHeight
    if (vw < 8 || vh < 8) return false
    if (cw < 1 || ch < 1) return false
    const inset = Math.min(FIT_INSET, Math.min(vw, vh) * 0.08)
    const zoom = clamp(
      Math.min((vw - inset * 2) / cw, (vh - inset * 2) / ch, MAX_FIT_ZOOM)
    )
    const next: View = {
      // Round to whole pixels: half-pixel offsets soften text and hairlines.
      tx: Math.round((vw - cw * zoom) / 2),
      ty: Math.round((vh - ch * zoom) / 2),
      zoom
    }
    fittedRef.current = next
    applyView(next)
    wrap.dataset.fitted = 'true'
    return true
  }, [applyView])

  const fit = useCallback((): void => {
    autoFitRef.current = true
    hostRectRef.current = null
    setPanHint(false)
    fitToViewport()
  }, [fitToViewport, setPanHint])

  /** Zoom keeping the world point under (sx, sy) fixed on screen. */
  const zoomAtScreen = useCallback(
    (nextZoom: number, sx: number, sy: number): void => {
      const rect = hostRect()
      if (!rect) return
      markManual()
      const { tx, ty, zoom } = viewRef.current
      const nz = clamp(nextZoom)
      if (nz === zoom) return
      const sxs = sx - rect.left
      const sys = sy - rect.top
      applyView({
        tx: sxs - ((sxs - tx) * nz) / zoom,
        ty: sys - ((sys - ty) * nz) / zoom,
        zoom: nz
      })
    },
    [applyView, hostRect, markManual]
  )

  const zoomCenter = useCallback(
    (factor: number): void => {
      setPanHint(false)
      hostRectRef.current = null
      const rect = hostRect()
      if (!rect) return
      zoomAtScreen(
        viewRef.current.zoom * factor,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      )
    },
    [hostRect, setPanHint, zoomAtScreen]
  )

  // Auto-fit: first measurable layout, then every content/viewport resize until
  // the user takes over. Covers async diagram renders (mermaid/graphviz), which
  // land long after mount. Fitting straight from the ResizeObserver callback
  // (not via rAF) keeps it in the same frame as the layout that triggered it, so
  // freshly rendered content is never painted at the pre-fit origin.
  useEffect(() => {
    const host = hostElRef.current
    const wrap = wrapperElRef.current
    if (!host || !wrap) return
    const onResize = (): void => {
      hostRectRef.current = null
      if (autoFitRef.current) fitToViewport()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(host)
    ro.observe(wrap)
    onResize()
    // Never leave content invisible if it never reports a measurable box.
    const reveal = window.setTimeout(() => {
      if (!fitToViewport()) wrap.dataset.fitted = 'true'
    }, REVEAL_FALLBACK_MS)
    return () => {
      ro.disconnect()
      window.clearTimeout(reveal)
    }
  }, [fitToViewport])

  // Native wheel: pinch/⌘+wheel zoom (cursor-anchored), plain two-finger pan.
  useEffect(() => {
    const el = hostElRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      // One layout read per gesture, not per event.
      if (e.timeStamp - lastWheelAtRef.current > 220) hostRectRef.current = null
      lastWheelAtRef.current = e.timeStamp
      const dy = wheelPx(e.deltaY, e.deltaMode)
      if (e.ctrlKey || e.metaKey) {
        // Zoom must re-raster — drop the compositor hint for this frame.
        setPanHint(false)
        const sensitivity = e.ctrlKey ? PINCH_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY
        const step = Math.min(
          MAX_WHEEL_STEP,
          Math.max(1 / MAX_WHEEL_STEP, Math.exp(-dy * sensitivity))
        )
        zoomAtScreen(viewRef.current.zoom * step, e.clientX, e.clientY)
        return
      }
      markManual()
      setPanHint(true)
      releasePanHintSoon()
      const dx = wheelPx(e.deltaX, e.deltaMode)
      const { tx, ty, zoom } = viewRef.current
      applyView({ tx: tx - dx, ty: ty - dy, zoom })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyView, markManual, releasePanHintSoon, setPanHint, zoomAtScreen])

  // Space key → pan mode.
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.key !== ' ' && e.code !== 'Space') return
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable))
        return
      if (spaceHeldRef.current) return
      spaceHeldRef.current = true
      setPanning(true)
      e.preventDefault()
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key !== ' ' && e.code !== 'Space') return
      spaceHeldRef.current = false
      if (!dragRef.current) setPanning(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(
    () => () => {
      if (commitRafRef.current != null) window.cancelAnimationFrame(commitRafRef.current)
      if (panHintTimerRef.current != null) window.clearTimeout(panHintTimerRef.current)
    },
    []
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent): void => {
      // Middle-drag pans too (space is awkward while a node is focused).
      const wantsPan = spaceHeldRef.current ? e.button === 0 : e.button === 1
      if (!wantsPan) return
      const el = hostElRef.current
      if (!el) return
      hostRectRef.current = null
      dragRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
      setPanning(true)
      setPanHint(true)
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      e.preventDefault()
    },
    [setPanHint]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent): void => {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      const dx = e.clientX - d.lastX
      const dy = e.clientY - d.lastY
      d.lastX = e.clientX
      d.lastY = e.clientY
      markManual()
      const { tx, ty, zoom } = viewRef.current
      applyView({ tx: tx + dx, ty: ty + dy, zoom })
    },
    [applyView, markManual]
  )

  const endDrag = useCallback(
    (e: React.PointerEvent): void => {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      dragRef.current = null
      setPanHint(false)
      if (!spaceHeldRef.current) setPanning(false)
    },
    [setPanHint]
  )

  const viewportProps = useMemo(
    () => ({
      ref: (el: HTMLElement | null): void => {
        hostElRef.current = el
      },
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag
    }),
    [onPointerDown, onPointerMove, endDrag]
  )

  const wrapperRef = useCallback((el: HTMLElement | null): void => {
    wrapperElRef.current = el
    if (el) {
      const { tx, ty, zoom } = viewRef.current
      el.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`
      // Hidden until the first fit lands, so content never flashes top-left.
      if (!el.dataset.fitted) el.dataset.fitted = 'false'
    }
  }, [])

  const contentStyle = useMemo<CSSProperties>(() => ({ transformOrigin: '0 0' }), [])

  const controls = useMemo(
    () => (
      <div className="canvas-zoom-controls">
        <button
          type="button"
          className="canvas-zoom-btn"
          onClick={() => zoomCenter(1 / BUTTON_FACTOR)}
          title={t('canvas.zoomOut')}
          aria-label={t('canvas.zoomOut')}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="canvas-zoom-readout"
          onClick={fit}
          title={t('canvas.zoomReset')}
        >
          {zoomPct}%
        </button>
        <button
          type="button"
          className="canvas-zoom-btn"
          onClick={() => zoomCenter(BUTTON_FACTOR)}
          title={t('canvas.zoomIn')}
          aria-label={t('canvas.zoomIn')}
        >
          <Plus size={14} />
        </button>
        {offFit ? (
          <button
            type="button"
            className="canvas-zoom-btn"
            onClick={fit}
            title={t('canvas.zoomReset')}
            aria-label={t('canvas.zoomReset')}
          >
            <Maximize2 size={14} />
          </button>
        ) : null}
      </div>
    ),
    [t, fit, zoomCenter, zoomPct, offFit]
  )

  return {
    zoom: zoomPct / 100,
    panning,
    contentStyle,
    wrapperRef,
    viewportProps,
    zoomIn: () => zoomCenter(BUTTON_FACTOR),
    zoomOut: () => zoomCenter(1 / BUTTON_FACTOR),
    fit,
    reset: fit,
    controls
  }
}
