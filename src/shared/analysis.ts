import type { AnalysisApiBalance } from './apiBalance.ts'
import type { HostAuthKind } from './cliAccountParse.ts'
import type { CliHostKind } from './cliHost.ts'
import { isStructuredCliHost } from './cliHost.ts'
import type { QuotaWindow, TokenSnapshot } from './types.ts'
import { sessionCostOf } from './tokenUsage.ts'

export type { AnalysisApiBalance } from './apiBalance.ts'

/** Built-in VAV API host key — same as `VAV_HOST_KEY` in types. */
export const ANALYSIS_API_HOST = 'vav'

export type AnalysisUsageKind = 'api' | 'agent'

export interface AnalysisUsageTotals {
  sessions: number
  turns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Combined USD (provider-reported sessions + rate-table estimates). */
  costUsd: number
  /** True when any contributing session used a rate-table estimate. */
  costApprox: boolean
}

export interface AnalysisHostUsage extends AnalysisUsageTotals {
  hostKey: string
  kind: AnalysisUsageKind
}

export interface AnalysisUsage {
  total: AnalysisUsageTotals
  api: AnalysisUsageTotals
  agent: AnalysisUsageTotals
  hosts: AnalysisHostUsage[]
}

export interface AnalysisProvider {
  hostKey: string
  hostName: string
  kind: AnalysisUsageKind
  signedIn: boolean
  accountId: string | null
  plan: string | null
  authKind: HostAuthKind
  windows: QuotaWindow[]
  /** Prepaid wallet when the configured VAV endpoint exposes one (DeepSeek). */
  balance?: AnalysisApiBalance | null
  /** `none` = no key; `unsupported` = endpoint has no balance API. */
  balanceState?: 'none' | 'unsupported' | 'ready' | 'error'
}

export interface AnalysisSnapshot {
  usage: AnalysisUsage
  providers: AnalysisProvider[]
  now: number
}

/** Lean conversation shape the aggregator needs — no message bodies. */
export interface AnalysisConversationInput {
  cliHost?: CliHostKind | null
  tokenHistory?: TokenSnapshot[]
  reportedSessionCostUsd?: number | null
  tokensUsed?: number
  hostTranscripts?: Record<
    string,
    {
      tokenHistory?: TokenSnapshot[]
      reportedSessionCostUsd?: number | null
      tokensUsed?: number
    }
  >
}

export interface AnalysisHostBucket {
  hostKey: string
  kind: AnalysisUsageKind
  tokenHistory: TokenSnapshot[]
  reportedSessionCostUsd: number | null
  tokensUsed: number
}

export function usageKindForHost(hostKey: string): AnalysisUsageKind {
  return hostKey === ANALYSIS_API_HOST ? 'api' : 'agent'
}

export function emptyUsageTotals(): AnalysisUsageTotals {
  return {
    sessions: 0,
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    costApprox: false
  }
}

function addTotals(target: AnalysisUsageTotals, extra: AnalysisUsageTotals): void {
  target.sessions += extra.sessions
  target.turns += extra.turns
  target.inputTokens += extra.inputTokens
  target.outputTokens += extra.outputTokens
  target.cacheReadTokens += extra.cacheReadTokens
  target.cacheWriteTokens += extra.cacheWriteTokens
  target.costUsd += extra.costUsd
  target.costApprox = target.costApprox || extra.costApprox
}

function bucketHasUsage(bucket: AnalysisHostBucket): boolean {
  return (
    bucket.tokenHistory.length > 0 ||
    (typeof bucket.reportedSessionCostUsd === 'number' &&
      Number.isFinite(bucket.reportedSessionCostUsd)) ||
    bucket.tokensUsed > 0
  )
}

function totalsFromBucket(bucket: AnalysisHostBucket): AnalysisUsageTotals {
  const history = bucket.tokenHistory
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  for (const row of history) {
    inputTokens += row.newInputTokens
    outputTokens += row.outputTokens
    cacheReadTokens += row.cacheReadTokens
    cacheWriteTokens += row.cacheWriteTokens
  }
  if (history.length === 0 && bucket.tokensUsed > 0) {
    inputTokens = bucket.tokensUsed
  }
  const reported =
    typeof bucket.reportedSessionCostUsd === 'number' &&
    Number.isFinite(bucket.reportedSessionCostUsd)
  const costUsd = reported ? Math.max(0, bucket.reportedSessionCostUsd!) : sessionCostOf(history)
  return {
    sessions: 1,
    turns: history.length,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd,
    costApprox: !reported && costUsd > 0
  }
}

/**
 * Active host lives on the conversation; parked hosts sit in
 * {@link AnalysisConversationInput.hostTranscripts}.
 */
export function hostBucketsFromConversation(
  conversation: AnalysisConversationInput
): AnalysisHostBucket[] {
  const activeKey = conversation.cliHost ?? ANALYSIS_API_HOST
  const parked = conversation.hostTranscripts ?? {}
  const buckets: AnalysisHostBucket[] = [
    {
      hostKey: activeKey,
      kind: usageKindForHost(activeKey),
      tokenHistory: conversation.tokenHistory ?? [],
      reportedSessionCostUsd: conversation.reportedSessionCostUsd ?? null,
      tokensUsed: conversation.tokensUsed ?? 0
    }
  ]
  for (const [key, parkedBucket] of Object.entries(parked)) {
    if (!key || key === activeKey) continue
    buckets.push({
      hostKey: key,
      kind: usageKindForHost(key),
      tokenHistory: parkedBucket.tokenHistory ?? [],
      reportedSessionCostUsd: parkedBucket.reportedSessionCostUsd ?? null,
      tokensUsed: parkedBucket.tokensUsed ?? 0
    })
  }
  return buckets
}

export function aggregateAnalysisUsage(
  conversations: AnalysisConversationInput[]
): AnalysisUsage {
  const byHost = new Map<string, AnalysisUsageTotals>()
  for (const conversation of conversations) {
    for (const bucket of hostBucketsFromConversation(conversation)) {
      if (!bucketHasUsage(bucket)) continue
      const current = byHost.get(bucket.hostKey) ?? emptyUsageTotals()
      addTotals(current, totalsFromBucket(bucket))
      byHost.set(bucket.hostKey, current)
    }
  }

  const api = emptyUsageTotals()
  const agent = emptyUsageTotals()
  const hosts: AnalysisHostUsage[] = [...byHost.entries()]
    .map(([hostKey, totals]) => ({
      hostKey,
      kind: usageKindForHost(hostKey),
      ...totals
    }))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'api' ? -1 : 1
      return b.costUsd - a.costUsd || b.turns - a.turns || a.hostKey.localeCompare(b.hostKey)
    })

  for (const host of hosts) {
    addTotals(host.kind === 'api' ? api : agent, host)
  }

  const total = emptyUsageTotals()
  addTotals(total, api)
  addTotals(total, agent)
  return { total, api, agent, hosts }
}

export function applyApiBalanceToSnapshot(
  snapshot: AnalysisSnapshot,
  lookup: { supported: boolean; balance: AnalysisApiBalance | null },
  apiKeyPresent: boolean
): AnalysisSnapshot {
  return {
    ...snapshot,
    providers: snapshot.providers.map((provider) => {
      if (provider.kind !== 'api') return provider
      if (!apiKeyPresent) {
        return { ...provider, balance: null, balanceState: 'none' }
      }
      if (!lookup.supported) {
        return { ...provider, balance: null, balanceState: 'unsupported' }
      }
      if (lookup.balance) {
        return { ...provider, balance: lookup.balance, balanceState: 'ready' }
      }
      return { ...provider, balance: null, balanceState: 'error' }
    })
  }
}

/** Keep cached provider/quota cards, replace usage from the live conversation set. */
export function snapshotWithFreshUsage(
  snapshot: AnalysisSnapshot,
  conversations: AnalysisConversationInput[]
): AnalysisSnapshot {
  return {
    ...snapshot,
    usage: aggregateAnalysisUsage(conversations),
    now: Date.now()
  }
}

export interface AnalysisProviderSeed {
  id: string
  name: string
}

/**
 * VAV first, then every provider that exists on this machine.
 * `presentIds` is binaries found on the login PATH. Catalogue order is kept;
 * custom settings rows (not in the catalogue) are appended. Enabled / removed
 * flags are ignored — a disabled or deleted-from-settings CLI still shows if
 * the binary is here.
 */
export function localAnalysisProviders(
  cliAgents: AnalysisProviderSeed[] | null | undefined,
  catalogue: AnalysisProviderSeed[] = [],
  presentIds?: Iterable<string> | null
): AnalysisProviderSeed[] {
  const configured = Array.isArray(cliAgents) ? cliAgents : []
  const names = new Map<string, string>()
  for (const row of catalogue) names.set(row.id, row.name)
  for (const row of configured) names.set(row.id, row.name)

  const configuredIds = new Set(configured.map((row) => row.id))
  const present = presentIds ? new Set(presentIds) : null
  const out: AnalysisProviderSeed[] = [{ id: ANALYSIS_API_HOST, name: 'VAV' }]
  const seen = new Set<string>([ANALYSIS_API_HOST])

  const take = (id: string): void => {
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push({ id, name: names.get(id) || id })
  }

  for (const row of catalogue) {
    if (!present || present.has(row.id) || configuredIds.has(row.id)) take(row.id)
  }
  for (const row of configured) take(row.id)
  return out
}

export function analysisProviderKind(hostKey: string): AnalysisUsageKind {
  return usageKindForHost(hostKey)
}

export function analysisHostOrNull(hostKey: string): CliHostKind | null {
  return isStructuredCliHost(hostKey) ? hostKey : null
}

/** Local provider cards when the account/quota probe has not run yet. */
export function stubAnalysisProviders(
  seeds: AnalysisProviderSeed[],
  apiKeyPresent: boolean,
  options?: { apiBalanceSupported?: boolean }
): AnalysisProvider[] {
  return seeds.map((seed) => {
    const kind = analysisProviderKind(seed.id)
    const isApi = kind === 'api'
    const balanceState: AnalysisProvider['balanceState'] = !isApi
      ? undefined
      : !apiKeyPresent
        ? 'none'
        : options?.apiBalanceSupported
          ? undefined
          : 'unsupported'
    return {
      hostKey: seed.id,
      hostName: seed.name,
      kind,
      signedIn: isApi ? apiKeyPresent : false,
      accountId: null,
      plan: null,
      authKind: isApi ? (apiKeyPresent ? 'api-key' : 'none') : 'unknown',
      windows: [],
      balance: null,
      balanceState
    }
  })
}
