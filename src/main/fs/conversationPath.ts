/**
 * Map a filesystem path to the conversation whose watched root contains it.
 * FileService uses this so list/read still hit the remote host when the
 * renderer omits conversationId (preview / rename / trash).
 */

export function pathContainedByRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)
}

export function longestContainingId(
  entries: Iterable<{ id: string; root: string }>,
  path: string
): string | undefined {
  if (!path) return undefined
  let best: { id: string; len: number } | undefined
  for (const { id, root } of entries) {
    if (!root) continue
    if (!pathContainedByRoot(path, root)) continue
    if (!best || root.length > best.len) best = { id, len: root.length }
  }
  return best?.id
}

export function conversationIdForWatchedPath(
  roots: ReadonlyMap<string, string>,
  path: string,
  explicit?: string | null
): string | undefined {
  if (explicit) return explicit
  return longestContainingId(
    Array.from(roots, ([id, root]) => ({ id, root })),
    path
  )
}

/** Fallback when the path is not under a watched FileService root. */
export function conversationIdForWorkdirs(
  cwd: string,
  metas: Array<{ id: string; workingDirectory?: string | null }>
): string | undefined {
  return longestContainingId(
    metas.flatMap((meta) =>
      meta.workingDirectory ? [{ id: meta.id, root: meta.workingDirectory }] : []
    ),
    cwd
  )
}
