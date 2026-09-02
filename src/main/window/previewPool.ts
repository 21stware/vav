/** Close an unfocused preview after idle; cap how many stay around. */
export const PREVIEW_IDLE_MS = 5 * 60 * 1000
export const PREVIEW_MAX_OPEN = 6
/** Default preview window width — see the note where it is clamped to the display. */
export const PREVIEW_DEFAULT_WIDTH = 880
/**
 * Hidden warm shells kept ready so the next open skips BrowserWindow+load.
 * Two, not one: a fresh shell needs ~1s of renderer boot before
 * `previewShellReady`, and opening a second file inside that window used to
 * fall all the way back to a cold create.
 */
export const PREVIEW_WARM_POOL = 2
/** Let the just-shown window paint before a replacement shell steals CPU. */
export const PREVIEW_POOL_REFILL_MS = 200

export function clampPreviewWidth(preferred: number, displayWidth: number, margin = 40): number {
  return Math.min(preferred, displayWidth - margin)
}

/** Oldest unfocused preview to park when the open cap is exceeded. */
export function nextUnfocusedPreviewPath(
  entries: Iterable<[string, { isDestroyed: () => boolean; isFocused: () => boolean }]>,
  keepPath: string
): string | null {
  for (const [otherPath, other] of entries) {
    if (otherPath === keepPath || other.isDestroyed()) continue
    if (!other.isFocused()) return otherPath
  }
  return null
}
