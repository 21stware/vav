import { hostCanShowApiBalance, type AnalysisApiBalance } from '../../shared/apiBalance.ts'
import { unknownAccount, type HostAccountInfo } from '../../shared/cliAccountParse.ts'
import type { AnalysisProvider, AnalysisSnapshot } from '../../shared/analysis.ts'
import {
  aggregateAnalysisUsage,
  analysisHostOrNull,
  analysisProviderKind,
  localAnalysisProviders
} from '../../shared/analysis.ts'
import { displayNameForCliHost, type CliHostKind } from '../../shared/cliHost.ts'
import {
  attachQuotaNamespace,
  hostMayHaveAccountQuota,
  latestQuotaWindowsByHost,
  mergeNamespacedQuotaWindows
} from '../../shared/quotaWindows.ts'
import type { Conversation, QuotaWindow } from '../../shared/types.ts'

export async function buildAnalysisSnapshot(input: {
  conversations: Conversation[]
  cliAgents: { id: string; name: string }[] | null | undefined
  catalogue?: { id: string; name: string }[]
  presentIds?: Iterable<string> | null
  vendors?: { id: string; name: string }[] | null
  order?: string[] | null
  remapHost?: (hostKey: string, accountId?: string | null) => string
  apiKeyPresent: boolean
  forceRefresh: boolean
  refreshQuotas: (force: boolean) => Promise<void>
  quotaWindows: (host: CliHostKind | null | undefined) => QuotaWindow[]
  readAccount: (host: CliHostKind | null) => Promise<HostAccountInfo>
  hasApiKey?: (hostKey: string) => boolean
  readApiBalance?: (hostKey: string) => Promise<{
    supported: boolean
    balance: AnalysisApiBalance | null
    keyPresent?: boolean
  }>
}): Promise<AnalysisSnapshot> {
  const usage = aggregateAnalysisUsage(input.conversations, {
    remapHost: input.remapHost,
    order: input.order
  })
  const seeds = localAnalysisProviders(
    input.cliAgents,
    input.catalogue ?? [],
    input.presentIds,
    { vendors: input.vendors, order: input.order }
  )
  try {
    await input.refreshQuotas(input.forceRefresh)
  } catch {
    // Quota poll is optional — still return local providers.
  }

  const conversationWindows = latestQuotaWindowsByHost(input.conversations)
  const providers: AnalysisProvider[] = await Promise.all(
    seeds.map(async (seed) => {
      const host = analysisHostOrNull(seed.id)
      const kind = analysisProviderKind(seed.id)
      if (kind === 'api') {
        const canBalance = hostCanShowApiBalance(seed.id)
        let keyPresent = input.hasApiKey?.(seed.id) ?? input.apiKeyPresent
        let balance: AnalysisApiBalance | null = null
        let balanceState: AnalysisProvider['balanceState'] = !keyPresent
          ? 'none'
          : 'unsupported'
        if (canBalance && input.readApiBalance) {
          try {
            const lookup = await input.readApiBalance(seed.id)
            if (lookup.keyPresent !== undefined) keyPresent = lookup.keyPresent
            if (!keyPresent) balanceState = 'none'
            else if (!lookup.supported) balanceState = 'unsupported'
            else if (lookup.balance) {
              balance = lookup.balance
              balanceState = 'ready'
            } else {
              balanceState = 'error'
            }
          } catch {
            balanceState = keyPresent ? 'error' : 'none'
          }
        }
        return {
          hostKey: seed.id,
          hostName: seed.name,
          kind,
          signedIn: keyPresent,
          accountId: null,
          plan: null,
          authKind: keyPresent ? 'api-key' : 'none',
          windows: [],
          balance,
          balanceState
        }
      }
      let account = unknownAccount()
      if (host) {
        try {
          account = await input.readAccount(host)
        } catch {
          account = unknownAccount()
        }
      }
      const polled = input.quotaWindows(host)
      const live = host ? (conversationWindows.get(host) ?? []) : []
      const identity = account.signedIn ? account.accountId : null
      const windows = hostMayHaveAccountQuota(host)
        ? mergeNamespacedQuotaWindows(
            host,
            identity,
            identity ? attachQuotaNamespace(polled, host, identity) : [],
            live
          )
        : []
      return {
        hostKey: seed.id,
        hostName: seed.name || (host ? displayNameForCliHost(host) : seed.id),
        kind,
        signedIn: account.signedIn,
        accountId: account.accountId,
        plan: account.plan,
        authKind: account.authKind,
        windows
      }
    })
  )

  return { usage, providers, now: Date.now() }
}
