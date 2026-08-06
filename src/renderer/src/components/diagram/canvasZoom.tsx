/**
 * Figma-style infinite canvas for the full-bleed diagram views
 * (mind map / mermaid / graphviz / draw.io).
 *
 * - Two-finger trackpad pan (wheel deltaX/deltaY).
 * - Space + left-drag pan (cursor switches to grab/grabbing).
 * - Trackpad pinch, ⌘/Ctrl+wheel, and +/− buttons all zoom anchored to the cursor.
 *
 * Implementation: the view renders its SVG/host inside a wrapper that carries
 * `transform: translate(tx, ty) scale(zoom)`. Pan/zoom are pure transforms
 * (no layout reflow, no scroll-container dependence), so the canvas can move
 * freely in any direction — content is never clipped to the initial viewport.
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

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const BUTTON_FACTOR = 1.25

const clamp = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

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
  reset: () => void
  /** Floating controls; render once inside the view root. */
  controls: React.JSX.Element
}

type View = { tx: number; ty: number; zoom: number }

export function useCanvasZoom(): CanvasZoom {
  const t = useT()
  const viewRef = useRef<View>({ tx: 0, ty: 0, zoom: 1 })
  const [view, setView] = useState<View>(viewRef.current)
  const [panning, setPanning] = useState(false)
  const spaceHeldRef = useRef(false)
  const hostElRef = useRef<HTMLElement | null>(null)
  const wrapperElRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    lastX: number
    lastY: number
  } | null>(null)

  /** Paint the transform without a React render (used during pan/drag). */
  const paint = useCallback((v: View): void => {
    const el = wrapperElRef.current
    if (!el) return
    el.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.zoom})`
  }, [])

  const applyView = useCallback(
    (next: View): void => {
      viewRef.current = next
      paint(next)
      setView(next)
    },
    [paint]
  )

  /** Zoom keeping the world point under (sx, sy) fixed on screen. */
  const zoomAtScreen = useCallback(
    (nextZoom: number, sx: number, sy: number): void => {
      const el = hostElRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const { tx, ty, zoom } = viewRef.current
      const nz = clamp(nextZoom)
      const sxs = sx - rect.left
      const sys = sy - rect.top
      const tx2 = sxs - ((sxs - tx) * nz) / zoom
      const ty2 = sys - ((sys - ty) * nz) / zoom
      applyView({ tx: tx2, ty: ty2, zoom: nz })
    },
    [applyView]
  )

  const zoomCenter = useCallback(
    (factor: number): void => {
      const el = hostElRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      zoomAtScreen(viewRef.current.zoom * factor, rect.left + rect.width / 2, rect.top + rect.height / 2)
    },
    [zoomAtScreen]
  )

  const reset = useCallback((): void => {
    applyView({ tx: 0, ty: 0, zoom: 1 })
  }, [applyView])

  // Native wheel: pinch/⌘+wheel zoom (cursor-anchored), plain two-finger pan.
  useEffect(() => {
    const el = hostElRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0035)
        zoomAtScreen(viewRef.current.zoom * factor, e.clientX, e.clientY)
        return
      }
      const { tx, ty, zoom } = viewRef.current
      applyView({ tx: tx - e.deltaX, ty: ty - e.deltaY, zoom })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyView, zoomAtScreen])

  // Space key → pan mode.
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.key !== ' ' && e.code !== 'Space') return
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
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

  const onPointerDown = useCallback((e: React.PointerEvent): void => {
    if (!spaceHeldRef.current) return
    if (e.button !== 0) return
    const el = hostElRef.current
    if (!el) return
    dragRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
    setPanning(true)
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    e.preventDefault()
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent): void => {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      const dx = e.clientX - d.lastX
      const dy = e.clientY - d.lastY
      d.lastX = e.clientX
      d.lastY = e.clientY
      const { tx, ty, zoom } = viewRef.current
      applyView({ tx: tx + dx, ty: ty + dy, zoom })
    },
    [applyView]
  )

  const endDrag = useCallback((e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    dragRef.current = null
    if (!spaceHeldRef.current) setPanning(false)
  }, [])

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
    }
  }, [])

  const contentStyle = useMemo<CSSProperties>(
    () => ({ transformOrigin: '0 0' }),
    []
  )

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
          onClick={reset}
          title={t('canvas.zoomReset')}
        >
          {Math.round(view.zoom * 100)}%
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
        {view.zoom !== 1 || view.tx !== 0 || view.ty !== 0 ? (
          <button
            type="button"
            className="canvas-zoom-btn"
            onClick={reset}
            title={t('canvas.zoomReset')}
            aria-label={t('canvas.zoomReset')}
          >
            <Maximize2 size={14} />
          </button>
        ) : null}
      </div>
    ),
    [t, reset, zoomCenter, view.zoom, view.tx, view.ty]
  )

  return {
    zoom: view.zoom,
    panning,
    contentStyle,
    wrapperRef,
    viewportProps,
    zoomIn: () => zoomCenter(BUTTON_FACTOR),
    zoomOut: () => zoomCenter(1 / BUTTON_FACTOR),
    reset,
    controls
  }
}
