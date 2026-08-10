/**
 * Wall-clock origin for a preview open, stamped by main when the double-click
 * (or Dock drop) arrived. Lets the renderer report true click→paint latency
 * instead of a `performance.now()` offset that starts after the IPC already
 * landed.
 */

let requestedAt = 0

export function setPreviewOpenClock(ms: number | null | undefined): void {
  requestedAt = ms && Number.isFinite(ms) ? ms : 0
}

/** Milliseconds since main accepted the open request, or null if unstamped. */
export function previewOpenElapsed(): number | null {
  return requestedAt ? Date.now() - requestedAt : null
}
