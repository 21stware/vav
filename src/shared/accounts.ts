/**
 * Provider accounts (Settings → Providers).
 * Profiles, keys, and endpoints are app data — a new temp folder must not hide them.
 */

import { LLM_VENDOR_CATALOGUE, vendorById, vendorFromEndpoint } from './llmVendors.ts'

export const DEFAULT_WORKSPACE_KEY = '__default__'
export const WORKSPACE_ACCOUNT_NAME = '__workspace__'
export const ACCOUNT_NAME_MAX = 40

export type AccountKind = 'vav_key' | 'oauth'
export type AccountKeyStatus = 'ok' | 'invalid' | 'unknown'
export type AccountProvider = 'vav' | 'anthropic' | 'openai' | 'custom'
export type AccountCreateKind = 'oauth' | 'key'

/** Provider support list: these agents add via OAuth. Everyone else uses the Key form. */
export const OAUTH_CREATE_AGENTS = ['grok', 'cursor'] as const
const OAUTH_CREATE_SET = new Set<string>(OAUTH_CREATE_AGENTS)

/** CLI logins we sync into Settings → Accounts (includes quota-only hosts). */
export const OAUTH_SYNC_AGENTS = ['grok', 'cursor', 'claude', 'codex', 'opencode'] as const
const OAUTH_SYNC_SET = new Set<string>(OAUTH_SYNC_AGENTS)

export function isOAuthSyncAgent(agentId: string): boolean {
  return OAUTH_SYNC_SET.has(agentId)
}

const OAUTH_SUPPORT_CATALOG: Array<{ id: string; name: string }> = [
  { id: 'cursor', name: 'Cursor' },
  { id: 'grok', name: 'Grok build' }
]

const OAUTH_DOMAIN: Record<string, string> = {
  claude: 'claude.ai',
  cursor: 'cursor.com',
  grok: 'x.ai',
  codex: 'openai.com',
  pi: 'pi.dev',
  devin: 'devin.ai',
  antigravity: 'antigravity.google',
  kiro: 'kiro.dev',
  opencode: 'opencode.ai',
  cline: 'cline.bot'
}

export interface ProviderAccount {
  id: string
  workspaceKey: string
  /** Settings → Providers catalogue id (`vav`, `claude`, `grok`, …). */
  agentId: string
  provider: AccountProvider
  kind: AccountKind
  /** Identity name (workspace seed, OAuth id, or name given at create). Not edited later. */
  name: string
  /** Optional nickname shown in the list and inspector. */
  alias: string | null
  endpoint: string | null
  /**
   * When true, the key lives in the legacy `api` secret (API & Models seed).
   * Editing the key on Accounts copies it to an account-specific secret.
   */
  usesLegacyApiKey: boolean
  current: boolean
  createdAt: number
  lastUsedAt: number | null
  lastModel: string | null
  keyStatus: AccountKeyStatus
  /** Host label for OAuth rows, e.g. `claude` / `codex`. */
  oauthHost: string | null
  /**
   * True only after this profile's host session is gone (logout or expiry).
   * Another live CLI identity does not expire siblings.
   */
  oauthExpired?: boolean
  /** Local encrypted copy of the host CLI slot — enables switch without OAuth. */
  hasCredentialSnapshot?: boolean
  credentialExpiresAtMs?: number | null
}

export interface AccountMonthUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  estimatedCostUsd: number
}

export type AccountUsageMap = Record<string, Record<string, AccountMonthUsage>>

export interface AccountUsageRow {
  accountId: string
  name: string
  tokens: number
  estimatedCostUsd: number
  percent: number
}

export interface SessionAccountUsageRow {
  accountId: string
  name: string
  tokens: number
  percent: number
}

export function workspaceKeyOf(dir: string | null | undefined): string {
  const trimmed = (dir ?? '').trim()
  if (!trimmed || trimmed === '~') return DEFAULT_WORKSPACE_KEY
  const stripped = trimmed.replace(/[\\/]+$/, '')
  return stripped || DEFAULT_WORKSPACE_KEY
}

export function pickWorkspaceConversation<T extends { id: string; archived?: boolean }>(
  conversations: T[],
  preferredId?: string | null
): T | undefined {
  const preferred = preferredId
    ? conversations.find((row) => row.id === preferredId && !row.archived)
    : undefined
  return preferred ?? conversations.find((row) => !row.archived)
}

export function workspaceLabelOf(dir: string | null | undefined, untitled: string): string {
  const key = workspaceKeyOf(dir)
  if (key === DEFAULT_WORKSPACE_KEY) return untitled
  const parts = key.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) || untitled
}

export function yearMonthOf(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/** First instant of the next calendar month (local). */
export function monthResetAt(yearMonth: string, now = Date.now()): number {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth)
  if (!match) {
    const date = new Date(now)
    return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime()
  }
  const year = Number(match[1])
  const month = Number(match[2])
  return new Date(year, month, 1).getTime()
}

export function emptyMonthUsage(): AccountMonthUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: 0
  }
}

export function usageTokensOf(usage: AccountMonthUsage | null | undefined): number {
  if (!usage) return 0
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

export function addUsage(
  current: AccountMonthUsage,
  delta: Partial<AccountMonthUsage>
): AccountMonthUsage {
  return {
    inputTokens: current.inputTokens + Math.max(0, delta.inputTokens ?? 0),
    outputTokens: current.outputTokens + Math.max(0, delta.outputTokens ?? 0),
    cacheReadTokens: current.cacheReadTokens + Math.max(0, delta.cacheReadTokens ?? 0),
    cacheWriteTokens: current.cacheWriteTokens + Math.max(0, delta.cacheWriteTokens ?? 0),
    estimatedCostUsd: current.estimatedCostUsd + Math.max(0, delta.estimatedCostUsd ?? 0)
  }
}

/** Known API brands inferred from the VAV key endpoint — not CLI hosts. */
export function apiProviderBrand(endpoint: string | null | undefined): string | null {
  return vendorFromEndpoint(endpoint)?.name ?? null
}

export function isGenericAccountIdentity(name: string | null | undefined): boolean {
  const n = (name ?? '').trim()
  if (!n) return true
  const lower = n.toLowerCase()
  return (
    lower === 'vav' ||
    lower === WORKSPACE_ACCOUNT_NAME ||
    lower === 'workspace' ||
    n === '账户' ||
    lower === 'account' ||
    /^账户\s*\d+$/.test(n) ||
    /^account\s*\d+$/i.test(n)
  )
}

export function endpointHostOf(endpoint: string | null | undefined): string | null {
  const raw = endpoint?.trim()
  if (!raw) return null
  try {
    return new URL(raw).host || null
  } catch {
    return raw.replace(/^https?:\/\//i, '').split('/')[0] || raw
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function normalizeAccountName(name: string): string {
  return name.trim().slice(0, ACCOUNT_NAME_MAX)
}

export function isWorkspaceAccountName(name: string): boolean {
  return name === WORKSPACE_ACCOUNT_NAME
}

export function displayAccountName(name: string, workspaceLabel: string): string {
  return isWorkspaceAccountName(name) ? workspaceLabel : name
}

export function displayAccountLabel(
  account: { name: string; alias?: string | null },
  workspaceLabel: string
): string {
  const alias = account.alias?.trim()
  if (alias) return alias
  return displayAccountName(account.name, workspaceLabel)
}

export function agentIdOf(account: {
  agentId?: string | null
  oauthHost?: string | null
  provider?: string | null
  endpoint?: string | null
}): string {
  const explicit = account.agentId?.trim()
  if (explicit && explicit !== 'vav') return explicit

  const vendor = vendorFromEndpoint(account.endpoint)
  if (vendor) return vendor.id

  if (explicit) return explicit
  const host = account.oauthHost?.trim()
  if (host) return host
  if (account.provider === 'anthropic') return 'claude'
  if (account.provider === 'openai') return 'codex'
  return 'vav'
}

export function createKindsForAgent(agentId: string): AccountCreateKind[] {
  return OAUTH_CREATE_SET.has(agentId) ? ['oauth', 'key'] : ['key']
}

export function createKindForAgent(agentId: string): AccountCreateKind {
  return createKindsForAgent(agentId)[0] ?? 'key'
}

export function defaultKeyEndpoint(agentId: string, fallback = ''): string {
  const vendor = vendorById(agentId)
  if (vendor?.endpoint) return vendor.endpoint
  if (agentId === 'codex') return 'https://api.openai.com'
  if (agentId === 'grok') return 'https://api.x.ai'
  if (agentId === 'claude') return 'https://api.anthropic.com'
  return fallback
}

/** Next locked identity for a new profile in this agent group (`账户 3` when 2 exist). */
export function nextDraftName(
  accounts: Array<{
    name: string
    agentId?: string | null
    provider?: string | null
    oauthHost?: string | null
  }>,
  agentId: string,
  untitled: string
): string {
  let n = accounts.filter((account) => agentIdOf(account) === agentId).length + 1
  if (n < 1) n = 1
  for (;;) {
    const name = `${untitled} ${n}`
    if (!nameConflict(accounts, agentId, name)) return name
    n += 1
  }
}

export function oauthDomainForAgent(agentId: string): string {
  return OAUTH_DOMAIN[agentId] ?? agentId
}

export function providerForAgent(agentId: string): AccountProvider {
  if (agentId === 'claude') return 'anthropic'
  if (agentId === 'codex') return 'openai'
  if (agentId === 'vav') return 'vav'
  return 'custom'
}

export function catalogGroups<T extends { createdAt: number; agentId?: string | null; oauthHost?: string | null; provider?: string | null; endpoint?: string | null }>(
  cliAgents: Array<{ id: string; name: string }>,
  accounts: T[]
): {
  agentId: string
  name: string
  createKind: AccountCreateKind
  createKinds: AccountCreateKind[]
  oauthDomain: string
  accounts: T[]
}[] {
  const buckets = new Map<string, T[]>()
  for (const account of accounts) {
    const id = agentIdOf(account)
    const list = buckets.get(id)
    if (list) list.push(account)
    else buckets.set(id, [account])
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt)
  }
  const order = [{ id: 'vav', name: 'VAV' }, ...cliAgents.filter((agent) => agent.id !== 'vav')]
  for (const vendor of LLM_VENDOR_CATALOGUE) {
    if (!order.some((agent) => agent.id === vendor.id)) order.push(vendor)
  }
  for (const extra of OAUTH_SUPPORT_CATALOG) {
    if (!order.some((agent) => agent.id === extra.id)) order.push(extra)
  }
  return order.map((agent) => ({
    agentId: agent.id,
    name: agent.name,
    createKind: createKindForAgent(agent.id),
    createKinds: createKindsForAgent(agent.id),
    oauthDomain: oauthDomainForAgent(agent.id),
    accounts: buckets.get(agent.id) ?? []
  }))
}

export function oauthIdentityKey(account: { agentId?: string | null; name: string }): string {
  return `${agentIdOf(account)}\0${account.name.trim().toLowerCase()}`
}

/** One row per agent + identity, including named VAV keys. */
export function accountIdentityKey(account: {
  kind?: string
  name: string
  agentId?: string | null
  oauthHost?: string | null
  provider?: string | null
}): string {
  if (account.kind === 'oauth') return oauthIdentityKey(account)
  return `${agentIdOf(account)}\0${account.name.trim().toLowerCase()}`
}

/** Temp folders minted by `mintTempWorkdir` (`…/vav/<8 hex>/Workspace`). */
export function isEphemeralWorkspaceKey(key: string): boolean {
  return /[/\\]vav[/\\][0-9a-f]{8}[/\\]Workspace$/i.test(key.replace(/\\/g, '/'))
}

/** Persist accounts under a stable key so a new temp session cannot orphan them. */
export function appWorkspaceKey(key: string): string {
  return isEphemeralWorkspaceKey(key) ? DEFAULT_WORKSPACE_KEY : key
}

/** CLI login identity (email) vs a stored OAuth profile name. */
export function oauthIdentityMatches(
  accountName: string,
  liveId: string | null | undefined
): boolean {
  const a = accountName.trim().toLowerCase()
  const b = (liveId ?? '').trim().toLowerCase()
  return !!a && !!b && a === b
}

/**
 * One live CLI login per host. Quota follows that identity alone.
 * Switching the live identity does not expire siblings — only a host
 * sign-out / dead session marks the previously live row expired.
 */
export function applyExclusiveOAuthSignIn<
  T extends {
    kind: string
    name: string
    keyStatus: AccountKeyStatus
    oauthExpired?: boolean
    hasCredentialSnapshot?: boolean
    agentId?: string | null
    oauthHost?: string | null
    provider?: string | null
  }
>(accounts: T[], agentId: string, liveName: string | null, signedIn: boolean): T[] {
  return accounts.map((account) => {
    if (account.kind !== 'oauth' || agentIdOf(account) !== agentId) return account
    const match = signedIn && oauthIdentityMatches(account.name, liveName)
    if (match) return { ...account, keyStatus: 'ok' as const, oauthExpired: false }
    if (!signedIn) {
      return {
        ...account,
        keyStatus: 'unknown' as const,
        oauthExpired:
          account.hasCredentialSnapshot === true
            ? false
            : account.keyStatus === 'ok' || account.oauthExpired === true
      }
    }
    return { ...account, keyStatus: 'unknown' as const, oauthExpired: false }
  })
}

/** Host quota belongs only to the live CLI identity — never a signed-out row. */
export function accountShowsOAuthQuota(account: {
  kind?: string
  oauthSignedIn: boolean
  hasCredentialSnapshot?: boolean
  quotaStatus?: string
}): boolean {
  if (account.kind === 'vav_key') return false
  if (!account.oauthSignedIn && account.hasCredentialSnapshot !== true) return false
  return account.quotaStatus !== 'none'
}

/** Same-agent OAuth row that currently holds the machine CLI login. */
export function liveOAuthSibling<
  T extends { id: string; agentId: string; kind: string; oauthSignedIn: boolean }
>(accounts: T[], account: { id: string; agentId: string; kind?: string }): T | null {
  if (account.kind !== 'oauth') return null
  return (
    accounts.find(
      (row) =>
        row.id !== account.id &&
        row.kind === 'oauth' &&
        row.agentId === account.agentId &&
        row.oauthSignedIn
    ) ?? null
  )
}

/** Quota on Accounts is the machine CLI login — only the live identity. */
export function isLiveOAuthProfile(
  account: {
    kind: string
    name: string
    keyStatus: string
    agentId?: string | null
    oauthHost?: string | null
    provider?: string | null
  },
  liveOAuth?: Map<string, string | null>
): boolean {
  if (account.kind !== 'oauth') return false
  const agentId = agentIdOf(account)
  if (liveOAuth?.has(agentId)) {
    return oauthIdentityMatches(account.name, liveOAuth.get(agentId))
  }
  return account.keyStatus === 'ok'
}

/** Host quota only when this profile is the live CLI login. */
export function sessionShowsHostQuota(input: {
  liveSignedIn: boolean
  liveIdentity?: string | null
  profileKind?: string | null
  profileName?: string | null
}): boolean {
  if (!input.liveSignedIn) return false
  if (input.profileKind === 'oauth') {
    return oauthIdentityMatches(input.profileName ?? '', input.liveIdentity)
  }
  return Boolean((input.liveIdentity ?? '').trim())
}

/** New CLI session follows a live OAuth login; a signed-out current never wins. */
export function resolveSessionAccountId(
  accounts: Array<{
    id: string
    kind: string
    keyStatus: string
    current: boolean
    provider?: string | null
    agentId?: string | null
    oauthHost?: string | null
  }>,
  agentId?: string | null
): string | null {
  if (!agentId || agentId === 'vav') {
    return (
      accounts.find((account) => account.provider === 'vav' && account.current)?.id ??
      accounts.find((account) => account.provider === 'vav')?.id ??
      null
    )
  }
  const rows = accounts.filter((account) => agentIdOf(account) === agentId)
  return (
    rows.find((account) => account.current && account.kind === 'oauth' && account.keyStatus === 'ok')
      ?.id ??
    rows.find((account) => account.kind === 'oauth' && account.keyStatus === 'ok')?.id ??
    rows.find((account) => account.current)?.id ??
    rows[0]?.id ??
    null
  )
}

/** One stored OAuth identity: prefer this workspace, then current, then signed-in, then oldest. */
export function preferOAuthAccount<
  T extends {
    workspaceKey: string
    current: boolean
    keyStatus: string
    createdAt: number
  }
>(rows: T[], workspaceKey?: string): T {
  return [...rows].sort((a, b) => {
    if (workspaceKey) {
      const localA = a.workspaceKey === workspaceKey ? 0 : 1
      const localB = b.workspaceKey === workspaceKey ? 0 : 1
      if (localA !== localB) return localA - localB
    }
    if (a.current !== b.current) return a.current ? -1 : 1
    if ((a.keyStatus === 'ok') !== (b.keyStatus === 'ok')) return a.keyStatus === 'ok' ? -1 : 1
    return a.createdAt - b.createdAt
  })[0]!
}

/**
 * Pick one stored row for a collapsed identity. A configured key wins over a
 * leftover seed; workspace is only a tie-break so temp folders cannot hide it.
 */
export function preferVisibleAccount<
  T extends {
    workspaceKey: string
    current: boolean
    keyStatus: string
    createdAt: number
    lastUsedAt?: number | null
  }
>(rows: T[], workspaceKey?: string): T {
  return [...rows].sort((a, b) => {
    if ((a.keyStatus === 'ok') !== (b.keyStatus === 'ok')) return a.keyStatus === 'ok' ? -1 : 1
    if (a.current !== b.current) return a.current ? -1 : 1
    const usedA = a.lastUsedAt ?? 0
    const usedB = b.lastUsedAt ?? 0
    if (usedA !== usedB) return usedB - usedA
    if (workspaceKey) {
      const localA = a.workspaceKey === workspaceKey ? 0 : 1
      const localB = b.workspaceKey === workspaceKey ? 0 : 1
      if (localA !== localB) return localA - localB
    }
    return a.createdAt - b.createdAt
  })[0]!
}

/**
 * App-wide account list. Same identity under one agent is one row.
 * Temp workspaces must not hide keys, endpoints, or saved OAuth profiles.
 */
export function visibleAccountsForWorkspace<T extends ProviderAccount>(
  accounts: T[],
  workspaceKey: string
): T[] {
  const groups = new Map<string, T[]>()
  const order: string[] = []
  for (const account of accounts) {
    const key = accountIdentityKey(account)
    const group = groups.get(key)
    if (group) group.push(account)
    else {
      groups.set(key, [account])
      order.push(key)
    }
  }
  return order.map((key) => preferVisibleAccount(groups.get(key)!, workspaceKey))
}

/** One highlight per agent: prefer a live current in this workspace. */
export function visibleCurrentIds(
  accounts: Array<
    Pick<ProviderAccount, 'id' | 'agentId' | 'workspaceKey' | 'current' | 'kind' | 'keyStatus'>
  >,
  workspaceKey: string
): Set<string> {
  const byAgent = new Map<string, Array<(typeof accounts)[number]>>()
  for (const account of accounts) {
    const id = agentIdOf(account)
    const list = byAgent.get(id)
    if (list) list.push(account)
    else byAgent.set(id, [account])
  }
  const live = (account: (typeof accounts)[number]): boolean =>
    account.kind !== 'oauth' || account.keyStatus === 'ok'
  const current = new Set<string>()
  for (const list of byAgent.values()) {
    const localCurrent = list.find((account) => account.workspaceKey === workspaceKey && account.current)
    const picked =
      (localCurrent && live(localCurrent) ? localCurrent : null) ??
      list.find((account) => account.current && live(account)) ??
      localCurrent ??
      list.find((account) => live(account)) ??
      list[0]
    if (picked) current.add(picked.id)
  }
  return current
}

export function usageRowsOf(
  accounts: Array<{ id: string; name: string }>,
  usage: AccountUsageMap,
  yearMonth: string,
  nameOf: (account: { id: string; name: string }) => string
): AccountUsageRow[] {
  const rows = accounts.map((account) => {
    const tokens = usageTokensOf(usage[account.id]?.[yearMonth])
    const estimatedCostUsd = usage[account.id]?.[yearMonth]?.estimatedCostUsd ?? 0
    return { accountId: account.id, name: nameOf(account), tokens, estimatedCostUsd, percent: 0 }
  })
  const total = rows.reduce((sum, row) => sum + row.tokens, 0)
  for (const row of rows) {
    row.percent = total > 0 ? (row.tokens / total) * 100 : 0
  }
  return rows
}

export function sessionUsageRowsOf(
  snapshots: Array<{ accountId?: string | null; newInputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; totalInputTokens?: number }>,
  nameById: Map<string, string>,
  fallbackName: string
): SessionAccountUsageRow[] {
  const totals = new Map<string, number>()
  for (const snapshot of snapshots) {
    const id = snapshot.accountId?.trim() || ''
    if (!id) continue
    const tokens =
      (snapshot.newInputTokens ?? 0) +
      (snapshot.outputTokens ?? 0) +
      (snapshot.cacheReadTokens ?? 0) +
      (snapshot.cacheWriteTokens ?? 0)
    const n = tokens > 0 ? tokens : snapshot.totalInputTokens ?? 0
    totals.set(id, (totals.get(id) ?? 0) + n)
  }
  const ids = [...totals.keys()]
  const total = ids.reduce((sum, id) => sum + (totals.get(id) ?? 0), 0)
  return ids.map((accountId) => ({
    accountId,
    name: nameById.get(accountId) || fallbackName,
    tokens: totals.get(accountId) ?? 0,
    percent: total > 0 ? ((totals.get(accountId) ?? 0) / total) * 100 : 0
  }))
}

/** Same pick the Providers UI uses — not a leftover workspace-local current. */
export function currentVisibleVav<T extends ProviderAccount>(
  accounts: T[],
  workspaceKey: string
): T | undefined {
  const visible = visibleAccountsForWorkspace(accounts, workspaceKey)
  const currentIds = visibleCurrentIds(visible, workspaceKey)
  return (
    visible.find((account) => agentIdOf(account) === 'vav' && currentIds.has(account.id)) ??
    visible.find((account) => agentIdOf(account) === 'vav' && account.current) ??
    visible.find((account) => agentIdOf(account) === 'vav')
  )
}

export function currentAccountId(
  accounts: Array<{ id: string; current: boolean; agentId?: string | null; provider?: string | null; oauthHost?: string | null }>,
  agentId = 'vav'
): string | null {
  return accounts.find((a) => agentIdOf(a) === agentId && a.current)?.id ?? null
}

export function nextCurrentAfterDelete(
  accounts: Array<{
    id: string
    createdAt: number
    agentId?: string | null
    provider?: string | null
    oauthHost?: string | null
  }>,
  removedId: string,
  agentId = 'vav'
): string | null {
  const remaining = accounts
    .filter((a) => a.id !== removedId && agentIdOf(a) === agentId)
    .sort((a, b) => a.createdAt - b.createdAt)
  return remaining[0]?.id ?? null
}

export function nameConflict(
  accounts: Array<{
    id?: string
    name: string
    agentId?: string | null
    provider?: string | null
    oauthHost?: string | null
  }>,
  agentId: string,
  name: string,
  exceptId?: string
): boolean {
  const normalized = normalizeAccountName(name).toLowerCase()
  if (!normalized) return false
  return accounts.some(
    (account) =>
      account.id !== exceptId &&
      agentIdOf(account) === agentId &&
      normalizeAccountName(account.name).toLowerCase() === normalized
  )
}

export function usageTone(percent: number): 'ok' | 'warn' | 'danger' | 'muted' {
  if (percent >= 100) return 'danger'
  if (percent >= 70) return 'warn'
  if (percent > 0) return 'muted'
  return 'muted'
}

export type AccountRowUsage =
  | { kind: 'invalid'; tone: 'danger' }
  | { kind: 'signedOut'; tone: 'muted' }
  | { kind: 'capped'; tone: 'danger' }
  | { kind: 'percent'; percent: number; tone: 'muted' | 'warn' }
  | { kind: 'syncing'; tone: 'muted' }
  | { kind: 'syncFailed'; tone: 'danger' }
  | { kind: 'balance'; amount: number; currency: string; available: boolean; tone: 'muted' | 'danger' }
  | { kind: 'tokens'; tokens: number; tone: 'muted' }

/**
 * List-row usage chip. Quota % wins when we have it.
 * "Syncing" only while a refresh is in flight — never because siblings exist.
 */
export function accountRowUsage(input: {
  kind: string
  keyStatus: string
  oauthSignedIn: boolean
  oauthExpired?: boolean
  quotaPercent: number | null
  quotaStatus: string
  monthTokens: number
  refreshing: boolean
  balance?: { amount: number; currency: string; available: boolean } | null
}): AccountRowUsage | null {
  if (input.kind === 'vav_key' && input.keyStatus === 'invalid') {
    return { kind: 'invalid', tone: 'danger' }
  }
  if (input.kind === 'oauth' && !input.oauthSignedIn && input.oauthExpired === true) {
    return { kind: 'signedOut', tone: 'muted' }
  }
  const quotaPct = input.quotaPercent
  if (quotaPct != null && quotaPct >= 100) return { kind: 'capped', tone: 'danger' }
  if (quotaPct != null) {
    return {
      kind: 'percent',
      percent: Math.round(quotaPct),
      tone: usageTone(quotaPct) === 'warn' ? 'warn' : 'muted'
    }
  }
  if (input.oauthSignedIn && (input.refreshing || input.quotaStatus === 'loading')) {
    return { kind: 'syncing', tone: 'muted' }
  }
  if (input.oauthSignedIn && input.quotaStatus === 'error') {
    return { kind: 'syncFailed', tone: 'danger' }
  }
  if (input.balance) {
    return {
      kind: 'balance',
      amount: input.balance.amount,
      currency: input.balance.currency,
      available: input.balance.available,
      tone: input.balance.available === false ? 'danger' : 'muted'
    }
  }
  if (input.monthTokens <= 0) return null
  return { kind: 'tokens', tokens: input.monthTokens, tone: 'muted' }
}

const QUOTA_KIND_RANK: Record<string, number> = {
  cursor_api: 0,
  monthly: 1,
  cursor_auto: 2,
  seven_day: 3,
  seven_day_opus: 4,
  seven_day_sonnet: 5,
  five_hour: 6,
  primary: 7,
  secondary: 8,
  other: 9
}

/** Prefer the longest window (monthly → weekly → 5h) for the row summary. */
export function primaryQuotaWindow<T extends { kind: string; usedPercent: number }>(
  windows: T[]
): T | null {
  if (!windows.length) return null
  return [...windows].sort(
    (a, b) => (QUOTA_KIND_RANK[a.kind] ?? 99) - (QUOTA_KIND_RANK[b.kind] ?? 99)
  )[0] ?? null
}

export function primaryQuotaPercent(
  windows: Array<{ kind: string; usedPercent: number }>
): number | null {
  const window = primaryQuotaWindow(windows)
  return window ? window.usedPercent : null
}

/** Rebuild monthly totals from retained session snapshots (one add per turn). */
export function usageFromSnapshots(
  snapshots: Array<{
    accountId?: string | null
    timestamp: number
    newInputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    estimatedCost?: number
  }>
): AccountUsageMap {
  const usage: AccountUsageMap = {}
  for (const snap of snapshots) {
    const id = snap.accountId?.trim()
    if (!id) continue
    const month = yearMonthOf(snap.timestamp)
    const bucket = usage[id] ?? (usage[id] = {})
    bucket[month] = addUsage(bucket[month] ?? emptyMonthUsage(), {
      inputTokens: snap.newInputTokens ?? 0,
      outputTokens: snap.outputTokens ?? 0,
      cacheReadTokens: snap.cacheReadTokens ?? 0,
      cacheWriteTokens: snap.cacheWriteTokens ?? 0,
      estimatedCostUsd: snap.estimatedCost ?? 0
    })
  }
  return usage
}

export function resolveAccountsFocus(
  page: {
    accounts: Array<{ id: string }>
    groups: Array<{ agentId: string; accounts: Array<{ id: string; current: boolean }> }>
  },
  focusAccountId?: string | null,
  focusAgentId?: string | null
): string | null {
  const accountId = focusAccountId?.trim()
  if (accountId && page.accounts.some((row) => row.id === accountId)) return accountId
  const agentId = focusAgentId?.trim()
  if (!agentId) return null
  const group = page.groups.find((row) => row.agentId === agentId)
  return group?.accounts.find((row) => row.current)?.id ?? group?.accounts[0]?.id ?? null
}

export function seedWorkspaceAccount(input: {
  id: string
  workspaceKey: string
  endpoint: string | null
  now?: number
}): ProviderAccount {
  return {
    id: input.id,
    workspaceKey: input.workspaceKey,
    agentId: 'vav',
    provider: 'vav',
    kind: 'vav_key',
    name: WORKSPACE_ACCOUNT_NAME,
    alias: null,
    endpoint: input.endpoint,
    usesLegacyApiKey: true,
    current: true,
    createdAt: input.now ?? Date.now(),
    lastUsedAt: null,
    lastModel: null,
    keyStatus: 'unknown',
    oauthHost: null,
    oauthExpired: false,
    hasCredentialSnapshot: false,
    credentialExpiresAtMs: null
  }
}
