/**
 * ⌘D remounts the split chrome around an existing xterm. Park/replay in that
 * gap dumps old-geometry alt-screen ANSI into the half-size terminal.
 *
 * Claim bumps a generation; a deferred park only runs if nothing claimed
 * again before the microtask (true hide / conversation switch).
 */
export function nextAttachGeneration(current: number): number {
  return current + 1
}

export function shouldParkDetachedHost(
  scheduledGeneration: number,
  currentGeneration: number,
  connected: boolean
): boolean {
  return scheduledGeneration === currentGeneration && !connected
}
