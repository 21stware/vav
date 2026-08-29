/**
 * Map a filesystem path to the conversation whose watched root contains it.
 * FileService uses this so list/read still hit the remote host when the
 * renderer omits conversationId (preview / rename / trash).
 */

export function conversationIdForWatchedPath(
  roots: ReadonlyMap<string, string>,
  path: string,
  explicit?: string | null
): string | undefined {
  if (explicit) return explicit
  if (!path) return undefined
  let best: { id: string; len: number } | undefined
  for (const [id, root] of roots) {
    if (path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)) {
      if (!best || root.length > best.len) best = { id, len: root.length }
    }
  }
  return best?.id
}
