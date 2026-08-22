/** First-open / double-click reset width as a fraction of the shell. */
export const PREVIEW_DEFAULT_RATIO = 0.42
export const PREVIEW_MIN = 320
/** Conversation column never shrinks below this when the preview is open. */
export const AGENT_MIN = 360
/** Fallback before the shell is measured (tight windows only). */
export const PREVIEW_FALLBACK_PX = 380

export function clampPreviewWidth(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Widest the preview may grow — leftover stays with the conversation. */
export function maxPreviewForShell(total: number): number {
  if (total <= 0) return PREVIEW_FALLBACK_PX
  return Math.max(PREVIEW_MIN, total - AGENT_MIN)
}

/** Default preview width — 42% of shell, within min/max. */
export function defaultPreviewForShell(total: number): number {
  if (total <= 0) return PREVIEW_FALLBACK_PX
  return clampPreviewWidth(
    Math.floor(total * PREVIEW_DEFAULT_RATIO),
    PREVIEW_MIN,
    maxPreviewForShell(total)
  )
}

/**
 * Shell grew or shrank: give the delta to the preview so the conversation
 * column stays put until the preview hits min/max.
 */
export function previewWidthAfterShellChange(opts: {
  preview: number
  prevTotal: number
  nextTotal: number
}): number {
  const max = maxPreviewForShell(opts.nextTotal)
  let next = opts.preview
  if (opts.prevTotal > 0 && opts.nextTotal !== opts.prevTotal) {
    next = opts.preview + (opts.nextTotal - opts.prevTotal)
  }
  return clampPreviewWidth(next, PREVIEW_MIN, max)
}

/** Companion / empty shell has no right-hand drawer — open a real window. */
export function shouldOpenStandaloneFilePreview(opts: {
  conversationId: string | null | undefined
  filePreviewHost: boolean
}): boolean {
  return !opts.conversationId || !opts.filePreviewHost
}
