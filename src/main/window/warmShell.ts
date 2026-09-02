/** Shared LIFO warm BrowserWindow pool: skip destroyed, skip not-yet-ready. */

export type WarmShellLike = {
  isDestroyed: () => boolean
}

/**
 * Pop the newest ready shell. Not-ready windows stay in the pool in original
 * order so an in-flight boot is not discarded.
 */
export function takeReadyWarmShell<T extends WarmShellLike>(
  pool: T[],
  isReady: (win: T) => boolean
): T | null {
  const notReady: T[] = []
  while (pool.length > 0) {
    const win = pool.pop()!
    if (win.isDestroyed()) continue
    if (!isReady(win)) {
      notReady.push(win)
      continue
    }
    pool.push(...notReady)
    return win
  }
  pool.push(...notReady)
  return null
}

/** Drop destroyed shells in place so refill counts stay honest. */
export function replaceLiveWarmPool<T extends WarmShellLike>(pool: T[]): void {
  const live = pool.filter((win) => !win.isDestroyed())
  pool.length = 0
  pool.push(...live)
}

/** Full pool → destroy the parked window instead of hiding it. */
export function shouldDestroyParkedWarmShell(poolLength: number, cap: number): boolean {
  return poolLength >= cap
}
