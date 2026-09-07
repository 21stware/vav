/**
 * Track which page/slide is in view for stacked document stages (PDF / DOCX / PPTX).
 * Scroll-driven index + programmatic goTo via scrollport offset.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export interface DocumentPageIndex {
  /** 1-based index of the page most in view */
  current: number
  /** Total pages (DOM count, or explicit override) */
  total: number
  goTo: (page1: number) => void
  prev: () => void
  next: () => void
  /** Call when DOM pages are added/removed without a scroll event */
  refresh: () => void
}

export function useDocumentPageIndex(opts: {
  /** Scrollport that owns the vertical page stack */
  scrollRef: RefObject<HTMLElement | null>
  /**
   * CSS selector for page frames, relative to the scroll root.
   */
  pageSelector: string
  /** When false, freezes state and skips observers */
  enabled?: boolean
  /**
   * Optional explicit total (e.g. PDF numPages before all placeholders mount).
   * Falls back to matched page count.
   */
  totalOverride?: number | null
  /**
   * Optional 1-based page number from element dataset.
   * When omitted, DOM order is used (1…n).
   */
  pageNumberFromEl?: (el: HTMLElement, index0: number) => number
}): DocumentPageIndex {
  const {
    scrollRef,
    pageSelector,
    enabled = true,
    totalOverride = null,
    pageNumberFromEl
  } = opts

  const [current, setCurrent] = useState(1)
  const [domTotal, setDomTotal] = useState(0)
  const currentRef = useRef(1)
  currentRef.current = current

  const collectPages = useCallback((): HTMLElement[] => {
    const root = scrollRef.current
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>(pageSelector))
  }, [scrollRef, pageSelector])

  const resolveIndex = useCallback((): { current: number; total: number } => {
    const root = scrollRef.current
    const pages = collectPages()
    const domN = pages.length
    const total =
      totalOverride != null && totalOverride > 0 ? Math.max(totalOverride, domN) : domN
    if (!root || domN === 0) {
      return { current: 1, total: Math.max(0, total) }
    }

    const rootRect = root.getBoundingClientRect()
    // Anchor slightly below the top so the “reading” page wins over a peeking prev page.
    const anchor = rootRect.top + Math.min(96, Math.max(32, rootRect.height * 0.22))

    let bestIdx = 0
    let bestScore = -Infinity

    for (let i = 0; i < pages.length; i++) {
      const r = pages[i]!.getBoundingClientRect()
      if (r.height <= 0 && r.width <= 0) continue
      // Prefer pages that contain the anchor line.
      if (r.top <= anchor && r.bottom > anchor) {
        const coverage = Math.min(r.bottom, rootRect.bottom) - Math.max(r.top, rootRect.top)
        const score = 10_000 + coverage
        if (score > bestScore) {
          bestScore = score
          bestIdx = i
        }
        continue
      }
      // Otherwise nearest top edge to the anchor.
      const dist = Math.abs(r.top - anchor)
      const score = -dist
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    const el = pages[bestIdx]!
    const page1 = pageNumberFromEl ? pageNumberFromEl(el, bestIdx) : bestIdx + 1
    return {
      current: Math.min(Math.max(1, page1), Math.max(1, total)),
      total: Math.max(0, total)
    }
  }, [scrollRef, collectPages, totalOverride, pageNumberFromEl])

  const refresh = useCallback(() => {
    if (!enabled) return
    const next = resolveIndex()
    setDomTotal(next.total)
    if (next.current !== currentRef.current) {
      currentRef.current = next.current
      setCurrent(next.current)
    }
  }, [enabled, resolveIndex])

  useEffect(() => {
    if (!enabled) return
    const root = scrollRef.current
    if (!root) return

    let raf = 0
    const schedule = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        refresh()
      })
    }

    refresh()
    root.addEventListener('scroll', schedule, { passive: true })

    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => schedule())
      ro.observe(root)
    }

    // Pages mount progressively (PDF placeholders, PPTX windowing).
    let mo: MutationObserver | null = null
    if (typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(() => schedule())
      mo.observe(root, { childList: true, subtree: true })
    }

    return () => {
      if (raf) cancelAnimationFrame(raf)
      root.removeEventListener('scroll', schedule)
      ro?.disconnect()
      mo?.disconnect()
    }
  }, [enabled, scrollRef, pageSelector, totalOverride, refresh])

  const goTo = useCallback(
    (page1: number) => {
      const root = scrollRef.current
      if (!root) return
      const pages = collectPages()
      if (!pages.length) return

      let target: HTMLElement | null = null
      if (pageNumberFromEl) {
        target =
          pages.find((el, i) => pageNumberFromEl(el, i) === page1) ??
          pages[Math.min(pages.length, Math.max(1, page1)) - 1] ??
          null
      } else {
        target = pages[Math.min(pages.length, Math.max(1, page1)) - 1] ?? null
      }
      if (!target) return

      const rootRect = root.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const nextTop = root.scrollTop + (targetRect.top - rootRect.top) - 12
      // Instant jump — no smooth scroll (page chrome is used often).
      root.scrollTo({ top: Math.max(0, nextTop), behavior: 'auto' })
      currentRef.current = page1
      setCurrent(page1)
    },
    [scrollRef, collectPages, pageNumberFromEl]
  )

  const total =
    totalOverride != null && totalOverride > 0 ? Math.max(totalOverride, domTotal) : domTotal

  const prev = useCallback(() => {
    goTo(Math.max(1, currentRef.current - 1))
  }, [goTo])

  const next = useCallback(() => {
    const max = total > 0 ? total : currentRef.current + 1
    goTo(Math.min(max, currentRef.current + 1))
  }, [goTo, total])

  return {
    current: total > 0 ? Math.min(current, total) : current,
    total,
    goTo,
    prev,
    next,
    refresh
  }
}
