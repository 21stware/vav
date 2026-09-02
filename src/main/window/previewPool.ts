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

export type PreviewCloseDisposition = 'destroy' | 'guard' | 'park'

/**
 * Preview close: quitting / deferred FS-close may destroy; unsaved edits
 * stay guarded; otherwise recycle into the warm pool.
 */
export function previewCloseDisposition(opts: {
  quitting: boolean
  fullscreenCloseAllowed: boolean
  hasUnsavedGuard: boolean
}): PreviewCloseDisposition {
  if (opts.quitting || opts.fullscreenCloseAllowed) return 'destroy'
  if (opts.hasUnsavedGuard) return 'guard'
  return 'park'
}

/** Unfocused, unguarded previews park after idle — not while the user is in them. */
export function shouldParkIdlePreview(opts: {
  destroyed: boolean
  focused: boolean
  guarded: boolean
}): boolean {
  return !opts.destroyed && !opts.focused && !opts.guarded
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

/** Query string for a file-preview renderer. */
export function previewQuery(
  path: string,
  options?: { origin?: 'dock' | 'session'; conversationId?: string; requestedAt?: number }
): Record<string, string> {
  const query: Record<string, string> = {
    view: 'file-preview',
    path,
    origin: options?.origin ?? 'session'
  }
  if (options?.conversationId) query.conversationId = options.conversationId
  if (options?.requestedAt) query.requestedAt = String(options.requestedAt)
  return query
}

/** Stable map key for preview windows (aliases / relative paths collapse). */
export function previewPathKey(
  filePath: string,
  fs: { exists: (path: string) => boolean; realpath: (path: string) => string }
): string {
  const raw = filePath.trim()
  if (!raw) return ''
  try {
    if (fs.exists(raw)) return fs.realpath(raw)
  } catch {
    // fall through
  }
  return raw
}
