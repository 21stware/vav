/**
 * Spacer-based sheet virtualization for the preview tables.
 *
 * The painted window is derived from `scrollTop` on every frame, never from a
 * stored offset: `topPad = start * rowPx` with `start <= floor(scrollTop/rowPx)`
 * means the paint can't start below the scrollport top, which is what produced
 * the blank bands when a stale row height and a fresh scroll offset disagreed.
 *
 * Row height is measured as the real pitch (border box + borders) of the painted
 * rows; when it changes we re-anchor `scrollTop` so the reader stays on the same
 * row instead of teleporting.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

const DEFAULT_ROW_PX = 28
/** Rows painted past each edge of the scrollport, so a fling can outrun React. */
const OVERSCAN_ROWS = 60
const MIN_VISIBLE_ROWS = 24
const MAX_PAINTED_ROWS = 800

export function useSheetVirtualWindow(
  wrapRef: RefObject<HTMLElement | null>,
  rowCount: number,
  /** Bump when the painted table identity changes (sheet tab, model). */
  layoutKey?: string | number
): {
  rowStart: number
  rowEnd: number
  windowSize: number
  rowPx: number
  topPad: number
  bottomPad: number
  revealRow: (index: number) => void
  onScroll: () => void
  resetScroll: () => void
} {
  const [range, setRange] = useState<{ start: number; end: number }>(() => ({
    start: 0,
    end: Math.min(rowCount, MIN_VISIBLE_ROWS + OVERSCAN_ROWS * 2)
  }))
  const [rowPx, setRowPx] = useState(DEFAULT_ROW_PX)
  const rowPxRef = useRef(DEFAULT_ROW_PX)
  const frameRef = useRef(0)

  const recompute = useCallback((): void => {
    const el = wrapRef.current
    if (!el) return
    const px = Math.max(8, rowPxRef.current)
    const headerH = el.querySelector('thead')?.getBoundingClientRect().height ?? 0
    const viewport = Math.max(120, el.clientHeight - headerH)
    const visible = Math.max(MIN_VISIBLE_ROWS, Math.ceil(viewport / px))
    const anchor = Math.max(0, Math.min(rowCount, Math.floor(el.scrollTop / px)))
    const start = Math.max(0, anchor - OVERSCAN_ROWS)
    const end = Math.min(
      rowCount,
      Math.min(start + MAX_PAINTED_ROWS, anchor + visible + OVERSCAN_ROWS)
    )
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [wrapRef, rowCount])

  const scheduleRecompute = useCallback((): void => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      recompute()
    })
  }, [recompute])

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    },
    []
  )

  // Re-fit when the sheet, its size, or the scrollport changes.
  useLayoutEffect(() => {
    recompute()
    const el = wrapRef.current
    if (!el) return
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(recompute) : null
    ro?.observe(el)
    window.addEventListener('resize', recompute)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', recompute)
    }
  }, [recompute, wrapRef, layoutKey, rowCount])

  // Measure real row pitch so spacer math matches paint.
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const rows = el.querySelectorAll<HTMLElement>('tbody > tr:not([aria-hidden])')
    if (rows.length < 3) return
    const first = rows[0]!.getBoundingClientRect()
    const last = rows[rows.length - 1]!.getBoundingClientRect()
    const pitch = (last.bottom - first.top) / rows.length
    if (!(pitch >= 12 && pitch <= 240)) return
    if (Math.abs(pitch - rowPxRef.current) < 0.5) return
    const anchorRow = Math.floor(el.scrollTop / Math.max(8, rowPxRef.current))
    rowPxRef.current = pitch
    setRowPx(pitch)
    el.scrollTop = anchorRow * pitch
    recompute()
  })

  const onScroll = scheduleRecompute

  const resetScroll = useCallback((): void => {
    const el = wrapRef.current
    if (el) el.scrollTop = 0
    setRange({ start: 0, end: Math.min(rowCount, MIN_VISIBLE_ROWS + OVERSCAN_ROWS * 2) })
    recompute()
  }, [wrapRef, rowCount, recompute])

  /** Bring a row into view (a few rows of lead-in), then repaint the window. */
  const revealRow = useCallback(
    (index: number): void => {
      const el = wrapRef.current
      if (!el) return
      const px = Math.max(8, rowPxRef.current)
      el.scrollTop = Math.max(0, (index - 3) * px)
      recompute()
    },
    [wrapRef, recompute]
  )

  const rowStart = Math.min(range.start, Math.max(0, rowCount - 1))
  const rowEnd = Math.min(rowCount, Math.max(range.end, rowStart))

  return {
    rowStart,
    rowEnd,
    windowSize: rowEnd - rowStart,
    rowPx,
    topPad: rowStart * rowPx,
    bottomPad: Math.max(0, rowCount - rowEnd) * rowPx,
    revealRow,
    onScroll,
    resetScroll
  }
}
