/** Dock / second-instance stacking: main < Quick Chat < Settings. */

export function windowIsInPlay(opts: {
  missing?: boolean
  destroyed?: boolean
  visible?: boolean
  minimized?: boolean
}): boolean {
  if (opts.missing || opts.destroyed) return false
  return !!opts.visible || !!opts.minimized
}

/**
 * Bottom → top ids. The focused Quick Chat is pinned last among companions
 * so `moveTop` after `focus()` does not bury it under siblings.
 */
export function appZOrderWindowIds(opts: {
  mainId: number | null
  quickChatIds: number[]
  settingsId: number | null
  focusedId: number | null
}): number[] {
  const ids: number[] = []
  if (opts.mainId != null) ids.push(opts.mainId)
  const focusedQuick =
    opts.focusedId != null && opts.quickChatIds.includes(opts.focusedId)
      ? opts.focusedId
      : null
  for (const id of opts.quickChatIds) {
    if (id === focusedQuick) continue
    ids.push(id)
  }
  if (focusedQuick != null) ids.push(focusedQuick)
  if (opts.settingsId != null) ids.push(opts.settingsId)
  return ids
}
