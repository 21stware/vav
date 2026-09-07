/**
 * Shared fit-to-width + pinch-zoom controller for paged document stages
 * (PDF / DOCX / PPTX).
 *
 * The stage is a plain scrollport and the content keeps a real layout size, so
 * panning is native scrolling — bounded by definition, with momentum and
 * scrollbars for free. Zoom only changes that layout size and re-anchors the
 * scroll offset, which is why this is not an infinite canvas.
 *
 * Auto-fit stays armed until the user pinches away from it. While armed, every
 * stage resize (window, agent panel, sidebar, column drag) re-fits. Once the
 * user is zoomed, resizes leave the document alone — a panel opening over it
 * just occludes part of the page. Pinching back onto fit re-arms auto-fit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  anchoredScroll,
  computeContainFit,
  DOC_FIT_MAX,
  settleDocScale,
  stageUsableBox,
  wheelZoomFactor
} from '../../lib/docZoom'

/** Below this the scale change is invisible — skip the style/layout churn. */
const SCALE_EPSILON = 0.0008

export type DocZoom = {
  scale: number
  /** True while the stage still tracks pane resizes. */
  atFit: boolean
  fit: () => void
  /** Jump to 100% (natural size), not contain/fit. */
  actualSize: () => void
  zoomBy: (factor: number) => void
  /** Content was replaced or re-measured — recompute fit and re-apply. */
  refresh: () => void
}

export function useDocZoom({
  stageRef,
  contentRef,
  naturalWidth,
  naturalHeight = 0,
  apply,
  maxFitScale = DOC_FIT_MAX,
  enabled = true
}: {
  /** The scrollport (the element with overflow + gutter padding). */
  stageRef: React.RefObject<HTMLElement | null>
  /** The element whose offset box is the laid-out content, for anchored zoom. */
  contentRef: React.RefObject<HTMLElement | null>
  /** Content width at 100% in CSS px. 0 until the document is measured. */
  naturalWidth: number
  /**
   * Content height at 100%. Pass it only for single-frame content (an image):
   * fit then means contain, so a tall photo opens whole instead of running off
   * the bottom. Paged documents leave it 0 and stay width-fitted.
   */
  naturalHeight?: number
  /** Write the scale to the DOM. Called synchronously, may run per wheel event. */
  apply: (scale: number) => void
  maxFitScale?: number
  enabled?: boolean
}): DocZoom {
  const applyRef = useRef(apply)
  applyRef.current = apply
  const naturalRef = useRef(naturalWidth)
  naturalRef.current = naturalWidth
  const naturalHeightRef = useRef(naturalHeight)
  naturalHeightRef.current = naturalHeight
  const maxFitRef = useRef(maxFitScale)
  maxFitRef.current = maxFitScale

  const scaleRef = useRef(1)
  /** Auto-fit armed. Cleared the moment a pinch leaves the fit scale. */
  const autoRef = useRef(true)
  const commitRafRef = useRef<number | null>(null)
  const [readout, setReadout] = useState({ scale: 1, atFit: true })

  /** Wheel ticks coalesce to one React readout per frame; `force` publishes now. */
  const commit = useCallback((immediate = false): void => {
    const publish = (): void => {
      commitRafRef.current = null
      const next = { scale: scaleRef.current, atFit: autoRef.current }
      setReadout((prev) =>
        Math.abs(prev.scale - next.scale) < SCALE_EPSILON && prev.atFit === next.atFit
          ? prev
          : next
      )
    }
    if (immediate) {
      if (commitRafRef.current != null) {
        window.cancelAnimationFrame(commitRafRef.current)
        commitRafRef.current = null
      }
      publish()
      return
    }
    if (commitRafRef.current != null) return
    commitRafRef.current = window.requestAnimationFrame(publish)
  }, [])

  const applyScale = useCallback(
    (next: number, atFit: boolean, force = false): void => {
      const changed = force || Math.abs(next - scaleRef.current) >= SCALE_EPSILON
      scaleRef.current = next
      autoRef.current = atFit
      if (changed) applyRef.current(next)
      commit(force)
    },
    [commit]
  )

  const measureFit = useCallback(
    (): number =>
      computeContainFit(
        stageUsableBox(stageRef.current),
        { width: naturalRef.current, height: naturalHeightRef.current },
        maxFitRef.current
      ),
    [stageRef]
  )

  const contentBox = useCallback((): { width: number; height: number } | null => {
    const el = contentRef.current
    if (!el) return null
    return { width: el.offsetWidth, height: el.offsetHeight }
  }, [contentRef])

  const fit = useCallback((): void => {
    applyScale(measureFit(), true, true)
  }, [applyScale, measureFit])

  /** Scale toward `target`, keeping the content point under the anchor pinned. */
  const zoomTo = useCallback(
    (target: number, anchor?: { x: number; y: number }): void => {
      const stage = stageRef.current
      if (!stage) return
      const settled = settleDocScale(target, measureFit())
      if (
        Math.abs(settled.scale - scaleRef.current) < SCALE_EPSILON &&
        settled.atFit === autoRef.current
      ) {
        return
      }

      // Prefer predicted boxes so we do not read offsetWidth after a style
      // write (that forced a layout on every pinch tick).
      const nw = naturalRef.current
      const nh = naturalHeightRef.current
      const before =
        nw > 0 && nh > 0
          ? { width: nw * scaleRef.current, height: nh * scaleRef.current }
          : contentBox()
      const view = {
        scrollLeft: stage.scrollLeft,
        scrollTop: stage.scrollTop,
        clientWidth: stage.clientWidth,
        clientHeight: stage.clientHeight
      }
      applyScale(settled.scale, settled.atFit, true)
      const after =
        nw > 0 && nh > 0
          ? { width: nw * settled.scale, height: nh * settled.scale }
          : contentBox()
      if (!before || !after) return

      const next = anchoredScroll({
        ...view,
        fromWidth: before.width,
        fromHeight: before.height,
        toWidth: after.width,
        toHeight: after.height,
        pointerX: anchor ? anchor.x : view.clientWidth / 2,
        pointerY: anchor ? anchor.y : view.clientHeight / 2
      })
      stage.scrollLeft = next.scrollLeft
      stage.scrollTop = next.scrollTop
    },
    [applyScale, contentBox, measureFit, stageRef]
  )

  const zoomBy = useCallback(
    (factor: number): void => {
      zoomTo(scaleRef.current * factor)
    },
    [zoomTo]
  )

  const actualSize = useCallback((): void => {
    zoomTo(1)
  }, [zoomTo])

  /**
   * Re-assert the current view on freshly mounted content. Needed when a
   * rewrite lands at the same natural width, so no state changed but the DOM
   * that carries the scale is brand new.
   */
  const refresh = useCallback((): void => {
    applyScale(autoRef.current ? measureFit() : scaleRef.current, autoRef.current, true)
  }, [applyScale, measureFit])

  // Pinch / ⌘-wheel zoom. Plain wheel is left alone so the scrollport pans.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !enabled) return
    let raf = 0
    let pendingFactor = 1
    let pendingX = 0
    let pendingY = 0
    const onWheel = (e: WheelEvent): void => {
      // Chromium reports trackpad pinch as wheel + ctrlKey.
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = stage.getBoundingClientRect()
      pendingFactor *= wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey)
      pendingX = e.clientX - rect.left
      pendingY = e.clientY - rect.top
      if (raf) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        const factor = pendingFactor
        pendingFactor = 1
        zoomTo(scaleRef.current * factor, { x: pendingX, y: pendingY })
      })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      if (raf) window.cancelAnimationFrame(raf)
      stage.removeEventListener('wheel', onWheel)
    }
  }, [enabled, stageRef, zoomTo])

  // Stage resize: re-fit only while auto-fit is armed.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !enabled || typeof ResizeObserver === 'undefined') return
    let raf = 0
    const ro = new ResizeObserver(() => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (autoRef.current) applyScale(measureFit(), true)
      })
    })
    ro.observe(stage)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [applyScale, enabled, measureFit, stageRef])

  // Natural size lands (or changes) after the document parses.
  useEffect(() => {
    if (!enabled || !(naturalWidth > 0)) return
    const nextFit = measureFit()
    if (autoRef.current) applyScale(nextFit, true, true)
  }, [applyScale, enabled, measureFit, naturalWidth, naturalHeight])

  useEffect(
    () => () => {
      if (commitRafRef.current != null) window.cancelAnimationFrame(commitRafRef.current)
    },
    []
  )

  return useMemo(
    () => ({ scale: readout.scale, atFit: readout.atFit, fit, actualSize, zoomBy, refresh }),
    [actualSize, fit, readout.atFit, readout.scale, refresh, zoomBy]
  )
}
