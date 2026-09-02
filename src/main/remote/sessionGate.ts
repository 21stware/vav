/** Phone companion: live sessions can be mutated; archived / missing cannot. */
export function remoteLiveConversation(
  conversation: { archived?: boolean } | null | undefined
): 'ok' | 'not-found' | 'archived' {
  if (!conversation) return 'not-found'
  if (conversation.archived) return 'archived'
  return 'ok'
}

/** Pinned then recent folders, existing only, capped for the phone host sheet. */
export function remoteHostRecentDirs(
  pinned: string[],
  recents: string[],
  opts: {
    exists: (path: string) => boolean
    label: (path: string) => string
    cap?: number
  }
): { path: string; label: string }[] {
  const cap = opts.cap ?? 12
  const seen = new Set<string>()
  const recentDirs: { path: string; label: string }[] = []
  for (const path of [...pinned, ...recents]) {
    if (!path || seen.has(path) || !opts.exists(path)) continue
    seen.add(path)
    recentDirs.push({ path, label: opts.label(path) })
    if (recentDirs.length >= cap) break
  }
  return recentDirs
}
