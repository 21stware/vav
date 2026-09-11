/** Misses in a row before we treat the parent as gone. */
export const DEV_PARENT_GONE_MISSES = 3
/** Ignore ESRCH right after wake — `kill -0` can flake for a few seconds. */
export const DEV_PARENT_WAKE_GRACE_MS = 10_000

export function shouldQuitForMissingParent(input: {
  consecutiveMisses: number
  now: number
  pausedUntil: number
  requiredMisses?: number
}): boolean {
  if (input.now < input.pausedUntil) return false
  return input.consecutiveMisses >= (input.requiredMisses ?? DEV_PARENT_GONE_MISSES)
}
