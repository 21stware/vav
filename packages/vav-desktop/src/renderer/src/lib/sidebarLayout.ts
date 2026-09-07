import { useEffect, useState } from 'react'

/**
 * Below this width the sidebar leaves the flex split and opens as a floating
 * overlay. Keep this well under the default window width (720) so normal
 * sessions stay docked; only genuinely narrow frames float.
 */
export const SIDEBAR_FLOAT_MAX = 560

export function useSidebarFloatMode(): boolean {
  const [floating, setFloating] = useState(() => window.innerWidth <= SIDEBAR_FLOAT_MAX)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const apply = (): void => {
      setFloating(window.innerWidth <= SIDEBAR_FLOAT_MAX)
    }
    const onResize = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(apply, 80)
    }
    window.addEventListener('resize', onResize, { passive: true })
    return () => {
      window.removeEventListener('resize', onResize)
      if (timer) clearTimeout(timer)
    }
  }, [])

  return floating
}
