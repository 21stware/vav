/**
 * Who owns Thread ↔ Swarm, and which warm-shell navigate is still valid.
 */

/** Companion is the writer; a parked main window (or reclaim) must follow it. */
export function resolveHydratedCliMode(opts: {
  remoteCli: boolean | undefined
  localCli: boolean
  followRemote: boolean
}): boolean {
  if (opts.remoteCli === true) return true
  if (opts.remoteCli === false) return opts.followRemote ? false : opts.localCli
  return opts.localCli
}

/** Main must not toggle surface while this conversation is in a companion. */
export function isCliSurfaceLocked(
  conversationId: string,
  detachedIds: readonly string[],
  isCompanion: boolean
): boolean {
  if (!conversationId || isCompanion) return false
  return detachedIds.includes(conversationId)
}

/**
 * Warm-shell navigate: ignore a park/claim whose seq is older than one we
 * already applied (park `''` arriving after a newer claim).
 */
export function acceptSessionNavigateSeq(
  prev: number,
  next: number | undefined
): { accept: boolean; seq: number } {
  if (next == null || !Number.isFinite(next)) return { accept: true, seq: prev }
  if (next < prev) return { accept: false, seq: prev }
  return { accept: true, seq: next }
}
