/**
 * Whether a structured CLI runtime / resume cursor must be dropped.
 *
 * Drivers bind cwd at spawn. The next turn starts a fresh session in the
 * new tree; {@link CliAgentHost} hands the stored transcript across so the
 * conversation continues.
 */
export function shouldReplaceCliRuntime(
  runtimeCwd: string | undefined,
  wantedCwd: string,
  starting: boolean
): boolean {
  return runtimeCwd !== wantedCwd || starting
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
