import { useEffect, useState } from 'react'
import { useSessionStore } from '../state/sessionStore'

/**
 * Below this width the sidebar leaves the flex split and opens as a floating
 * overlay. Keep this well under the default window width (720) so normal
 * sessions stay docked; only genuinely narrow frames float.
 */
export const SIDEBAR_FLOAT_MAX = 560

/**
 * Who owns the traffic-light bay, and whether the next column must indent.
 *
 * `sidebar` — docked list titlebar already clears the lights.
 * `rail` — collapsed capsule occupies the leading edge; leftover lead
 *   (`--chrome-lead` minus the rail) applies to the first content chrome.
 * `flush` — no in-flow list column; first content chrome takes the full lead
 *   so tabs / agent controls are not painted under the lights.
 */
export type ChromeLeadMode = 'sidebar' | 'rail' | 'flush'

export function chromeLeadMode(input: {
  floating: boolean
  sidebarVisible: boolean
}): ChromeLeadMode {
  if (!input.floating && input.sidebarVisible) return 'sidebar'
  if (!input.floating && !input.sidebarVisible) return 'rail'
  return 'flush'
}

function shellViewportWidth(): number {
  if (typeof document === 'undefined') return SIDEBAR_FLOAT_MAX + 1
  return document.documentElement.clientWidth
}

export function useSidebarFloatMode(): boolean {
  const [floating, setFloating] = useState(() => shellViewportWidth() <= SIDEBAR_FLOAT_MAX)

  useEffect(() => {
    const node = document.documentElement
    const apply = (width: number): void => {
      const next = width <= SIDEBAR_FLOAT_MAX
      setFloating((prev) => (prev === next ? prev : next))
    }
    apply(node.clientWidth)
    const observer = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect.width ?? node.clientWidth)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return floating
}

/** Sidebar toggle in the content header — collapsed rail or floating overlay. */
export function shouldShowShellLeading(sidebarVisible: boolean): boolean {
  return !sidebarVisible
}

export function useShowShellLeading(): boolean {
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  return shouldShowShellLeading(sidebarVisible)
}
