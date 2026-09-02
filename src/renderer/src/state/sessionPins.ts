/**
 * Sidebar pin / favorite list algebra. Returns null when settings should
 * stay put (already in the desired state, or a synthetic path).
 */

/** Favorite conversation ids: prepend on pin, drop on unpin. */
export function nextFavoriteIds(
  current: readonly string[],
  id: string,
  favorite: boolean
): string[] | null {
  const has = current.includes(id)
  if (favorite && !has) return [id, ...current]
  if (!favorite && has) return current.filter((entry) => entry !== id)
  return null
}

/** Pinned project folders: skip temp / synthetic `__` groups. */
export function nextPinnedWorkspaceDirs(
  current: readonly string[],
  workdir: string,
  pinned: boolean
): string[] | null {
  const path = workdir.trim()
  if (!path || path.startsWith('__')) return null
  const rest = current.filter((entry) => entry !== path)
  if (pinned && rest.length === current.length) return [path, ...rest]
  if (!pinned && rest.length !== current.length) return rest
  return null
}
