/**
 * Whether a structured CLI runtime / resume cursor must be dropped.
 *
 * Drivers bind cwd at spawn. The next turn starts a fresh session in the
 * new tree; {@link CliAgentHost} hands the stored transcript across so the
 * conversation continues.
 *
 * An in-flight spawn is only replaced when its bound cwd actually moved.
 * Same-path re-asserts (Files watch, session bind, vav-server setWorkspace)
 * must not cancel the handshake — that was sealing empty
 * "This turn was cancelled" leaves on the first Cursor prompt.
 */
export function shouldReplaceCliRuntime(
  runtimeCwd: string | undefined,
  wantedCwd: string,
  starting: boolean,
  previousCwd?: string | null
): boolean {
  const boundCwd = runtimeCwd ?? (starting ? previousCwd ?? undefined : undefined)
  if (boundCwd != null && boundCwd === wantedCwd) return false
  if (boundCwd != null) return true
  if (previousCwd != null && previousCwd === wantedCwd) return false
  return true
}

/**
 * Drop a stored resume cursor when the host kind or auth identity no longer
 * matches. Identity mismatch also tells the caller to hand the transcript
 * across to a fresh native session.
 */
export function spawnResumeCursor<T extends { provider: string }>(
  cursor: T | null | undefined,
  kind: string,
  liveIdentity: string | null | undefined,
  identityOf: (cursor: T) => string | null
): { cursor: T | null; dropIdentity: boolean } {
  if (!cursor || cursor.provider !== kind) return { cursor: null, dropIdentity: false }
  const stored = identityOf(cursor)
  if (liveIdentity && stored && stored !== liveIdentity) {
    return { cursor: null, dropIdentity: true }
  }
  return { cursor, dropIdentity: false }
}
