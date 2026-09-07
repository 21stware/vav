/**
 * Type-size zoom for reflowing previews (markdown, code, CSV / XLSX sheets).
 *
 * Deliberately *not* the geometric zoom paged documents use. Those have a page
 * box, so scaling it is the honest thing to do. Text has no page: scaling it
 * would blur glyphs on the way up and lock the measure to whatever width the
 * pane happened to have. So this drives a font-size multiplier instead and lets
 * the content reflow, which is what ⌘+ does in a browser — bigger type, same
 * column, no horizontal scrollbar.
 *
 * The zoom is published as a CSS variable on the host, so every surface under
 * it (prose, code lines, table cells) scales from one write, and the React
 * readout it also keeps is what re-renders virtualized views so they can
 * re-measure their row pitch against the new type size.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { settleTextZoom, wheelZoomFactor } from './docZoom'
import { notifyDocZoom } from './selectionChrome'

/** Custom property read by the preview stylesheets. */
const TEXT_ZOOM_VAR = '--text-zoom'
const ZOOM_EPSILON = 0.001

export type TextZoom = {
  scale: number
  /** True at 100%, where the zoom chrome idles out of the way. */
  atFit: boolean
  fit: () => void
  zoomBy: (factor: number) => void
}

/**
 * Nearest scrolling ancestor of the pointer, bounded by the host. Which element
 * actually scrolls differs per preview (the code canvas owns its own scrollport,
 * markdown lets the body scroll), so it is found from the event rather than
 * configured per view.
 */
function scrollPortFrom(target: EventTarget | null, host: HTMLElement): HTMLElement | null {
  let el: Element | null = target instanceof Element ? target : null
  const stop = host.parentElement
  while (el && el !== stop) {
    if (el instanceof HTMLElement && el.scrollHeight - el.clientHeight > 1) {
      const overflow = getComputedStyle(el).overflowY
      if (overflow === 'auto' || overflow === 'scroll') return el
    }
    el = el.parentElement
  }
  return null
}

export function useTextZoom({
  hostRef,
  enabled = true
}: {
  /** Element that carries the CSS variable — an ancestor of every text surface. */
  hostRef: React.RefObject<HTMLElement | null>
  enabled?: boolean
}): TextZoom {
  const scaleRef = useRef(1)
  const [readout, setReadout] = useState({ scale: 1, atFit: true })
  /** Last scrollport the reader touched, so button zooms anchor like wheel zooms. */
  const portRef = useRef<HTMLElement | null>(null)

  const zoomTo = useCallback(
    (target: number, port?: HTMLElement | null): void => {
      const host = hostRef.current
      if (!host) return
      const settled = settleTextZoom(target)
      if (Math.abs(settled.scale - scaleRef.current) < ZOOM_EPSILON) return

      const sport = port ?? portRef.current
      // Fraction of the document sitting above the middle of the port. A ratio
      // survives reflow; a pixel offset does not.
      const anchor =
        sport && sport.scrollHeight - sport.clientHeight > 1
          ? (sport.scrollTop + sport.clientHeight / 2) / sport.scrollHeight
          : null

      scaleRef.current = settled.scale
      host.style.setProperty(TEXT_ZOOM_VAR, String(settled.scale))
      setReadout(settled)
      // Reflow only — geometric zoom must not remasure. See SelectionChrome.
      notifyDocZoom(host)

      if (sport && anchor != null) {
        const restore = (): void => {
          const max = Math.max(0, sport.scrollHeight - sport.clientHeight)
          sport.scrollTop = Math.min(
            max,
            Math.max(0, anchor * sport.scrollHeight - sport.clientHeight / 2)
          )
        }
        // Once against the reflowed layout, once after virtualized views have
        // repainted at the new row height.
        restore()
        requestAnimationFrame(restore)
      }
    },
    [hostRef]
  )

  const zoomBy = useCallback(
    (factor: number): void => {
      zoomTo(scaleRef.current * factor)
    },
    [zoomTo]
  )

  const fit = useCallback((): void => {
    zoomTo(1)
  }, [zoomTo])

  // Reset when the view stops being zoomable, so a stale multiplier can't leak
  // onto the next file.
  useEffect(() => {
    if (enabled) return
    const host = hostRef.current
    scaleRef.current = 1
    host?.style.removeProperty(TEXT_ZOOM_VAR)
    setReadout((prev) => (prev.atFit ? prev : { scale: 1, atFit: true }))
  }, [enabled, hostRef])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !enabled) return
    const onWheel = (e: WheelEvent): void => {
      // Chromium reports a trackpad pinch as wheel + ctrlKey.
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const port = scrollPortFrom(e.target, host)
      if (port) portRef.current = port
      zoomTo(scaleRef.current * wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey), port)
    }
    const onScroll = (e: Event): void => {
      if (e.target instanceof HTMLElement) portRef.current = e.target
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    host.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      host.removeEventListener('wheel', onWheel)
      host.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [enabled, hostRef, zoomTo])

  return useMemo(
    () => ({ scale: readout.scale, atFit: readout.atFit, fit, zoomBy }),
    [fit, readout.atFit, readout.scale, zoomBy]
  )
}
