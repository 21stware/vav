import type { AnalysisApiBalance } from '../../shared/apiBalance.ts'
import type { AnalysisConversationInput, AnalysisSnapshot } from '../../shared/analysis.ts'
import {
  aggregateAnalysisUsage,
  applyApiBalanceToSnapshot,
  snapshotWithFreshUsage
} from '../../shared/analysis.ts'

type FullBuilder = (force: boolean) => Promise<AnalysisSnapshot>
type BalanceReader = (
  force: boolean,
  hostKey: string
) => Promise<{
  supported: boolean
  balance: AnalysisApiBalance | null
  keyPresent?: boolean
}>

let cached: AnalysisSnapshot | null = null
let building: Promise<AnalysisSnapshot> | null = null
let pendingForce = false
let builder: FullBuilder | null = null
let conversations: (() => AnalysisConversationInput[]) | null = null
let usageOptions: (() => {
  remapHost?: (hostKey: string, accountId?: string | null) => string
  order?: string[] | null
}) | null = null
let readBalance: BalanceReader | null = null
let apiKeyPresent: (() => boolean) | null = null
let onUpdated: ((snapshot: AnalysisSnapshot) => void) | null = null

export function configureAnalysisCache(options: {
  build: FullBuilder
  conversations: () => AnalysisConversationInput[]
  usageOptions?: () => {
    remapHost?: (hostKey: string, accountId?: string | null) => string
    order?: string[] | null
  }
  readBalance?: BalanceReader
  apiKeyPresent?: () => boolean
  onUpdated?: (snapshot: AnalysisSnapshot) => void
}): void {
  builder = options.build
  conversations = options.conversations
  usageOptions = options.usageOptions ?? null
  readBalance = options.readBalance ?? null
  apiKeyPresent = options.apiKeyPresent ?? null
  onUpdated = options.onUpdated ?? null
}

export function peekAnalysisCache(): AnalysisSnapshot | null {
  return cached
}

export function resetAnalysisCacheForTests(): void {
  cached = null
  building = null
  pendingForce = false
  builder = null
  conversations = null
  usageOptions = null
  readBalance = null
  apiKeyPresent = null
  onUpdated = null
}

/**
 * Stale-while-revalidate. Cached providers return immediately with live usage;
 * account/quota rebuilds run in the background unless `refresh` is set.
 */
export function invalidateAnalysisCache(): void {
  cached = null
}

export async function serveAnalysisSnapshot(options?: {
  refresh?: boolean
}): Promise<AnalysisSnapshot> {
  const force = options?.refresh === true
  const cachedNeedsKey =
    Boolean(cached) &&
    cached?.providers.some((p) => p.kind === 'api' && p.balanceState === 'none') &&
    apiKeyPresent?.() === true
  if (!force && cached && conversations && !cachedNeedsKey) {
    cached = snapshotWithFreshUsage(cached, conversations(), usageOptions?.())
    const ready = cached
    void patchCachedBalance(false, ready).then((next) => {
      cached = next
    })
    void syncAnalysisSnapshot(false)
    return ready
  }
  if (!force) {
    const preview = usagePreview()
    void syncAnalysisSnapshot(false)
    if (preview) return preview
  }
  return syncAnalysisSnapshot(force)
}

function usagePreview(): AnalysisSnapshot | null {
  if (!conversations) return null
  const usage = aggregateAnalysisUsage(conversations(), usageOptions?.())
  if (!cached && usage.total.sessions === 0) return null
  return {
    usage,
    providers: cached?.providers ?? [],
    now: Date.now()
  }
}

async function patchCachedBalance(
  force: boolean,
  snapshot: AnalysisSnapshot
): Promise<AnalysisSnapshot> {
  if (!readBalance) return snapshot
  try {
    let next = snapshot
    for (const provider of snapshot.providers) {
      if (provider.kind !== 'api') continue
      const lookup = await readBalance(force, provider.hostKey)
      const keyPresent = lookup.keyPresent ?? apiKeyPresent?.() !== false
      next = applyApiBalanceToSnapshot(next, lookup, keyPresent, provider.hostKey)
    }
    onUpdated?.(next)
    return next
  } catch (err) {
    console.error('[analysis] balance patch failed', err)
    return snapshot
  }
}

async function syncAnalysisSnapshot(force: boolean): Promise<AnalysisSnapshot> {
  if (!builder) throw new Error('analysis cache is not configured')
  pendingForce ||= force
  if (building) return building
  building = (async () => {
    try {
      let snapshot: AnalysisSnapshot | null = null
      do {
        const useForce = pendingForce
        pendingForce = false
        snapshot = await builder(useForce)
        if (conversations) snapshot = snapshotWithFreshUsage(snapshot, conversations(), usageOptions?.())
        cached = snapshot
        onUpdated?.(snapshot)
      } while (pendingForce)
      return snapshot!
    } finally {
      building = null
    }
  })()
  return building
}
