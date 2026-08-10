import { useEffect, useState, type ComponentType } from 'react'

/**
 * `React.lazy` replacement for chunks a warm preview shell has usually already
 * pulled in.
 *
 * A Suspense boundary that flashes a fallback pays React's ~300 ms
 * fallback→content reveal throttle. For an already-resident chunk that throttle
 * *was* the open latency: the file appeared 300 ms after everything needed to
 * draw it was in memory. This renders synchronously when the module is in
 * memory and degrades to a plain async swap (no Suspense) on a real cold miss.
 */
export interface WarmComponent<P> {
  /** Load the chunk ahead of first render. Safe to call repeatedly. */
  prefetch: () => Promise<unknown>
  /**
   * The component once resident, else null while the chunk loads.
   * Pass `enabled: false` to keep the chunk unrequested (callers that must run
   * the hook unconditionally but only need one of several canvases).
   */
  use: (enabled?: boolean) => ComponentType<P> | null
}

export function createWarmComponent<P>(
  load: () => Promise<ComponentType<P>>
): WarmComponent<P> {
  let loaded: ComponentType<P> | null = null
  let pending: Promise<ComponentType<P>> | null = null

  const ensure = (): Promise<ComponentType<P>> => {
    pending ??= load().then((component) => {
      loaded = component
      return component
    })
    return pending
  }

  return {
    prefetch: () => ensure().catch(() => undefined),
    use: (enabled = true) => {
      const [component, setComponent] = useState(() => loaded)
      useEffect(() => {
        if (!enabled || component) return
        let alive = true
        void ensure().then((next) => {
          if (alive) setComponent(() => next)
        })
        return () => {
          alive = false
        }
      }, [enabled, component])
      return enabled ? component : null
    }
  }
}
