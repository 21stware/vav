import type { AnalysisApiBalance } from '../../shared/apiBalance.ts'
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
  apiKeyPresent: boolean
  forceRefresh: boolean
  refreshQuotas: (force: boolean) => Promise<void>
  quotaWindows: (host: CliHostKind | null | undefined) => QuotaWindow[]
  readAccount: (host: CliHostKind | null) => Promise<HostAccountInfo>
  readApiBalance?: () => Promise<{
    supported: boolean
    balance: AnalysisApiBalance | null
  }>
}): Promise<AnalysisSnapshot> {
  const usage = aggregateAnalysisUsage(input.conversations)
  const seeds = localAnalysisProviders(
    input.cliAgents,
    input.catalogue ?? [],
    input.presentIds
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
        let balance: AnalysisApiBalance | null = null
        let balanceState: AnalysisProvider['balanceState'] = input.apiKeyPresent
          ? 'unsupported'
          : 'none'
        if (input.apiKeyPresent && input.readApiBalance) {
          try {
            const lookup = await input.readApiBalance()
            if (!lookup.supported) balanceState = 'unsupported'
            else if (lookup.balance) {
              balance = lookup.balance
              balanceState = 'ready'
            } else {
              balanceState = 'error'
            }
          } catch {
            balanceState = 'error'
          }
        }
        return {
          hostKey: seed.id,
          hostName: seed.name,
          kind,
          signedIn: input.apiKeyPresent,
          accountId: null,
          plan: null,
          authKind: input.apiKeyPresent ? 'api-key' : 'none',
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
