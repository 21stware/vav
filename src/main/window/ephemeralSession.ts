/**
 * Empty ⌘⇧↵ ephemeral shells die on close. Anything with messages, a
 * non-vav agent, a CLI host, or a live PTY stays.
 */
export function isDisposableEphemeralSession(
  stale:
    | {
        messages: unknown[]
        agentBinaryName?: string | null
        cliHost?: string | null
      }
    | null
    | undefined,
  hasPty: boolean
): boolean {
  if (!stale) return false
  const agentActive =
    (!!stale.agentBinaryName && stale.agentBinaryName !== 'vav') || !!stale.cliHost
  return stale.messages.length === 0 && !agentActive && !hasPty
}

/** Companion windows that still exist — main UI must not dual-attach PTYs. */
export function liveDetachedConversationIds(
  entries: Iterable<[string, { isDestroyed: () => boolean } | null | undefined]>
): string[] {
  const ids: string[] = []
  for (const [id, win] of entries) {
    if (win && !win.isDestroyed()) ids.push(id)
  }
  return ids
}
