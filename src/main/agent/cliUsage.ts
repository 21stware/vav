export function usageHasTurnTokens(
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number
): boolean {
  return input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0
}

export function isDuplicateTokenSnapshot(
  last:
    | {
        newInputTokens: number
        outputTokens: number
        cacheReadTokens: number
        cacheWriteTokens: number
      }
    | null
    | undefined,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number
): boolean {
  return (
    last != null &&
    last.newInputTokens === input &&
    last.outputTokens === output &&
    last.cacheReadTokens === cacheRead &&
    last.cacheWriteTokens === cacheWrite
  )
}

export function usageContextFill(
  contextUsed: number | undefined,
  snapshotTotal: number | null
): number | null {
  if (typeof contextUsed === 'number' && contextUsed >= 0) return contextUsed
  return snapshotTotal
}

export function usageEventIsNoop(opts: {
  fill: number | null
  recordHistory: boolean
  contextSize?: number | null
  sessionCostUsd?: number | null
  quotaChanged: boolean
}): boolean {
  return (
    opts.fill == null &&
    !opts.recordHistory &&
    opts.contextSize == null &&
    opts.sessionCostUsd == null &&
    !opts.quotaChanged
  )
}

/** Renderer usage event from a conversation row after tokens/quota change. */
export function usageSnapshotPayload<H, Q, C>(
  conversationId: string,
  updated: {
    tokensUsed: number
    tokenLimit: number
    tokenHistory: H
    cacheCreatedAt: C
    cacheExpiresAt: C
    reportedSessionCostUsd?: number | null
    quotaWindows?: Q[] | null
  },
  extras?: { newSnapshot?: boolean }
): {
  type: 'usage'
  conversationId: string
  tokensUsed: number
  tokenLimit: number
  history: H
  cacheCreatedAt: C
  cacheExpiresAt: C
  reportedSessionCostUsd: number | null
  quotaWindows: Q[]
  newSnapshot: boolean
} {
  return {
    type: 'usage',
    conversationId,
    tokensUsed: updated.tokensUsed,
    tokenLimit: updated.tokenLimit,
    history: updated.tokenHistory,
    cacheCreatedAt: updated.cacheCreatedAt,
    cacheExpiresAt: updated.cacheExpiresAt,
    reportedSessionCostUsd: updated.reportedSessionCostUsd ?? null,
    quotaWindows: updated.quotaWindows ?? [],
    newSnapshot: extras?.newSnapshot === true
  }
}
