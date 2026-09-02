import type { ConversationMeta } from '@shared/types'
import { DEFAULT_CLI_AGENTS } from '@shared/types'
import type {
  AccountApiBalance,
  AccountGroupView,
  AccountQuotaStatus,
  AccountView,
  AccountsPagePayload
} from '@shared/ipc'
import type { QuotaWindow } from '@shared/types'
import {
  agentIdOf,
  catalogGroups,
  displayAccountLabel,
  displayAccountName,
  endpointHostOf,
  isLiveOAuthProfile,
  monthResetAt,
  OAUTH_SYNC_AGENTS,
  primaryQuotaPercent,
  providerForAgent,
  usageRowsOf,
  usageTokensOf,
  pickWorkspaceConversation,
  currentVisibleVav,
  visibleCurrentIds,
  workspaceKeyOf,
  workspaceLabelOf,
  yearMonthOf,
  type AccountUsageMap,
  type ProviderAccount
} from '@shared/accounts'
import type { AccountStore } from '../store/AccountStore'
import type { SecretStore } from '../store/SecretStore'
import { captureLiveHost } from './activateAccount.ts'
import { readHostAccountInfo } from '../agent/hostAuth'
import { isLocalMachine, parseWorkspaceRefList } from '@shared/workspaceHost'
import { isStructuredCliHost, type CliHostKind } from '@shared/cliHost'
import { hostMayHaveAccountQuota, selectQuotaWindows } from '@shared/quotaWindows'

export function resolveWorkspaceContext(
  conversations: ConversationMeta[],
  settings: { defaultWorkingDirectory?: string; recentWorkspaceDirectories?: unknown },
  untitled: string,
  preferredId?: string | null
): { key: string; label: string; dir: string | null } {
  const latest = pickWorkspaceConversation(conversations, preferredId)
  const firstLocal = parseWorkspaceRefList(settings.recentWorkspaceDirectories).find((ref) =>
    isLocalMachine(ref.machineId)
  )?.path
  const dir =
    latest?.workingDirectory ||
    settings.defaultWorkingDirectory?.trim() ||
    firstLocal ||
    null
  const key = workspaceKeyOf(dir)
  return { key, label: workspaceLabelOf(dir, untitled), dir }
}

export function accountSecret(
  account: ProviderAccount,
  secrets: SecretStore
): string | null {
  if (account.kind !== 'vav_key') return null
  if (account.usesLegacyApiKey) return secrets.get('api')
  return secrets.getAccountKey(account.id)
}

export function accountHasKey(account: ProviderAccount, secrets: SecretStore): boolean {
  const key = accountSecret(account, secrets)
  return !!key && key.length > 0
}

export function resolveVavCredentials(
  input: {
    conversation?: { workingDirectory?: string | null; accountId?: string | null } | null
    workspaceKey?: string
    settingsEndpoint: string
  },
  accounts: AccountStore,
  secrets: SecretStore
): { apiKey: string | null; endpoint: string; accountId: string | null } {
  const workspaceKey = input.workspaceKey ?? workspaceKeyOf(input.conversation?.workingDirectory)
  accounts.seedIfNeeded({
    workspaceKey,
    endpoint: input.settingsEndpoint || null,
    hasApiKey: secrets.has('api')
  })
  const pinned = input.conversation?.accountId
    ? accounts.get(input.conversation.accountId)
    : undefined
  const account =
    pinned && pinned.kind === 'vav_key'
      ? pinned
      : currentVisibleVav(accounts.listAll(), workspaceKey) ?? accounts.currentVav(workspaceKey)
  if (account) {
    return {
      apiKey: accountSecret(account, secrets),
      endpoint: account.endpoint?.trim() || input.settingsEndpoint,
      accountId: account.id
    }
  }
  return {
    apiKey: secrets.get('api'),
    endpoint: input.settingsEndpoint,
    accountId: null
  }
}

export function cliCatalogOf(settings: {
  cliAgents?: Array<{ id: string; name: string }> | null
  removedCliAgentIds?: string[] | null
}): Array<{ id: string; name: string }> {
  if (Array.isArray(settings.cliAgents) && settings.cliAgents.length > 0) {
    return settings.cliAgents.map((agent) => ({ id: agent.id, name: agent.name }))
  }
  const removed = new Set(settings.removedCliAgentIds ?? [])
  return DEFAULT_CLI_AGENTS.filter((agent) => !removed.has(agent.id)).map((agent) => ({
    id: agent.id,
    name: agent.name
  }))
}

/**
 * CLI login is machine-wide. Align stored OAuth rows with the live identity
 * and return that identity (email) per host. `null` means signed out.
 */
export async function syncOAuthProfiles(
  workspaceKey: string,
  accounts: AccountStore,
  options?: { skipAgents?: Iterable<string>; secrets?: import('../store/SecretStore').SecretStore }
): Promise<Map<string, string | null>> {
  const skip = new Set(options?.skipAgents ?? [])
  const live = new Map<string, string | null>()
  await Promise.all(
    OAUTH_SYNC_AGENTS.filter((host) => !skip.has(host)).map(async (host) => {
      try {
        const info = await readHostAccountInfo(host)
        const email = info.accountId?.trim() || null
        if (!info.signedIn) {
          accounts.applyLiveOAuth(host, null, false)
          live.set(host, null)
          return
        }
        if (email) {
          live.set(host, email)
          const hit = accounts.applyLiveOAuth(host, email, true)
          if (!hit) {
            accounts.upsertOAuth({
              workspaceKey,
              agentId: host,
              provider: providerForAgent(host),
              name: email,
              oauthHost: host,
              signedIn: true
            })
          }
          accounts.promoteLiveOAuthCurrent(workspaceKey, host, email)
          if (options?.secrets) {
            await captureLiveHost(host, email, accounts, options.secrets)
          }
          return
        }
        const kept = accounts.keepOneOAuthSignedIn(host)
        live.set(host, kept?.name ?? null)
      } catch {
        // Host not installed / unreadable — keep the last known identity.
      }
    })
  )
  return live
}

export function buildAccountsPage(input: {
  workspaceKey: string
  workspaceLabel: string
  accounts: AccountStore
  secrets: SecretStore
  cliAgents: Array<{ id: string; name: string }>
  liveOAuth?: Map<string, string | null>
  quotaWindows?: (host: CliHostKind) => QuotaWindow[]
  quotaState?: (host: CliHostKind, identity?: string | null) => {
    windows: QuotaWindow[]
    status: AccountQuotaStatus
    updatedAt: number | null
    error: string | null
  }
  apiBalance?: (accountId: string) => AccountApiBalance | null
}): AccountsPagePayload {
  const rows = input.accounts.listVisible(input.workspaceKey)
  const currentIds = visibleCurrentIds(rows, input.workspaceKey)
  const usage = input.accounts.usage()
  const month = yearMonthOf(Date.now())
  const compare = usageRowsOf(rows, usage, month, (account) =>
    displayAccountLabel(account, input.workspaceLabel)
  )
  const percentById = new Map(compare.map((row) => [row.accountId, row.percent]))
  const views = rows.map((account) =>
    toAccountView(
      { ...account, current: currentIds.has(account.id) },
      input.secrets,
      usage,
      month,
      input.workspaceLabel,
      percentById,
      input.quotaWindows,
      input.quotaState,
      input.liveOAuth,
      input.apiBalance
    )
  )
  const viewById = new Map(views.map((view) => [view.id, view]))
  const groups: AccountGroupView[] = catalogGroups(input.cliAgents, rows).map((group) => ({
    agentId: group.agentId,
    name: group.name,
    createKind: group.createKind,
    createKinds: group.createKinds,
    oauthDomain: group.oauthDomain,
    accounts: group.accounts
      .map((account) => viewById.get(account.id))
      .filter((view): view is AccountView => !!view)
  }))
  return {
    workspaceKey: input.workspaceKey,
    workspaceLabel: input.workspaceLabel,
    groups,
    accounts: views,
    usage: compare
  }
}

function toAccountView(
  account: ProviderAccount,
  secrets: SecretStore,
  usage: AccountUsageMap,
  month: string,
  workspaceLabel: string,
  percentById: Map<string, number>,
  quotaWindows?: (host: CliHostKind) => QuotaWindow[],
  quotaState?: (host: CliHostKind, identity?: string | null) => {
    windows: QuotaWindow[]
    status: AccountQuotaStatus
    updatedAt: number | null
    error: string | null
  },
  liveOAuth?: Map<string, string | null>,
  apiBalance?: (accountId: string) => AccountApiBalance | null
): AccountView {
  const monthUsage = usage[account.id]?.[month]
  const keyPresent = accountHasKey(account, secrets)
  const host = account.oauthHost
  const signedIn = isLiveOAuthProfile(account, liveOAuth)
  const canPoll = Boolean(
    (signedIn || account.hasCredentialSnapshot) && host && hostMayHaveAccountQuota(host)
  )
  const state =
    canPoll && host && hostMayHaveAccountQuota(host) && quotaState
      ? quotaState(host, account.name)
      : null
  const raw = canPoll
    ? state?.windows ?? (quotaWindows && host && isStructuredCliHost(host) ? quotaWindows(host) : [])
    : []
  const windows = canPoll && host ? selectQuotaWindows(raw, host, account.name) : []
  const quotaPercent = primaryQuotaPercent(windows)
  return {
    id: account.id,
    agentId: agentIdOf(account),
    provider: account.provider,
    kind: account.kind,
    name: displayAccountLabel(account, workspaceLabel),
    identityName: displayAccountName(account.name, workspaceLabel),
    alias: account.alias?.trim() || null,
    endpoint: account.endpoint,
    endpointHost: endpointHostOf(account.endpoint),
    current: account.current,
    keyPresent,
    keyHint: account.usesLegacyApiKey
      ? secrets.maskedHint('api')
      : secrets.maskedAccountHint(account.id),
    keyStatus: signedIn ? 'ok' : account.kind === 'oauth' ? 'unknown' : account.keyStatus,
    oauthHost: account.oauthHost,
    oauthSignedIn: signedIn,
    oauthExpired: account.kind === 'oauth' && !signedIn && account.oauthExpired === true,
    lastModel: account.lastModel,
    hasCredentialSnapshot: account.hasCredentialSnapshot === true,
    credentialExpiresAtMs: account.credentialExpiresAtMs ?? null,
    lastUsedAt: account.lastUsedAt,
    monthTokens: usageTokensOf(monthUsage),
    monthCostUsd: monthUsage?.estimatedCostUsd ?? 0,
    monthPercent: percentById.get(account.id) ?? 0,
    monthResetsAt: monthResetAt(month),
    quotaWindows: windows,
    quotaPercent,
    quotaStatus: canPoll ? (state?.status ?? (windows.length > 0 ? 'ready' : 'idle')) : 'none',
    quotaUpdatedAt: state?.updatedAt ?? null,
    quotaError: state?.error ?? null,
    balance: account.kind === 'vav_key' ? (apiBalance?.(account.id) ?? null) : null
  }
}
