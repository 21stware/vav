/** Preview kinds that are displayed, not edited, in the file canvas. */
export function isMediaPreviewKind(
  kind: string | null | undefined
): boolean {
  return kind === 'image' || kind === 'audio' || kind === 'video'
}

const MEDIA_PATH =
  /\.(png|jpe?g|gif|webp|bmp|svg|ico|heic|heif|hif|tif|tiff|avif|mp3|mp4|m4a|aac|flac|ogg|wav|mov|webm|mkv)$/i

/** Path-based media check for event handlers that may not have inspect yet. */
export function isMediaPreviewPath(path: string): boolean {
  return MEDIA_PATH.test(path)
}

/**
 * Whether a disk / agent notify should arm the unsaved-close guard.
 *
 * Images and other media have no in-canvas editor. Watcher noise on open
 * (sibling writes, first inspect, HEIC temp JPEG) must not trap the window
 * behind Save/Discard — there is no baseline to restore.
 */
export function shouldArmUnsavedFromExternalChange(opts: {
  kind: string | null | undefined
  hadPriorIdentity: boolean
  identityChanged: boolean
  /** Agent named this path (`fs-changed` / working-copy notify). */
  namedSource: boolean
  workingCopyDirty: boolean
}): boolean {
  if (isMediaPreviewKind(opts.kind)) return opts.workingCopyDirty
  if (!opts.hadPriorIdentity && !opts.namedSource) return false
  if (!opts.identityChanged && !opts.namedSource) return false
  return true
}
