import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  addUsage,
  agentIdOf,
  appWorkspaceKey,
  applyExclusiveOAuthSignIn,
  DEFAULT_WORKSPACE_KEY,
  emptyMonthUsage,
  isEphemeralWorkspaceKey,
  nextCurrentAfterDelete,
  oauthIdentityKey,
  isGenericAccountIdentity,
  oauthIdentityMatches,
  preferOAuthAccount,
  preferVisibleAccount,
  seedWorkspaceAccount,
  usageFromSnapshots,
  visibleAccountsForWorkspace,
  yearMonthOf,
  type AccountKeyStatus,
  type AccountMonthUsage,
  type AccountProvider,
  type AccountUsageMap,
  type ProviderAccount
} from '../../shared/accounts.ts'

interface AccountFile {
  accounts: ProviderAccount[]
  usage: AccountUsageMap
}

const EMPTY: AccountFile = { accounts: [], usage: {} }

/**
 * Provider accounts. Keys stay in {@link SecretStore};
 * this file only holds names, endpoints, and usage totals.
 */
export class AccountStore {
  private readonly file: string
  private data: AccountFile = { accounts: [], usage: {} }
  private loaded = false

  constructor(userData: string) {
    this.file = join(userData, 'accounts.json')
  }

  load(): ProviderAccount[] {
    if (this.loaded) return this.data.accounts
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<AccountFile>
        this.data = {
          accounts: Array.isArray(raw.accounts) ? raw.accounts.map(coerceAccount) : [],
          usage: raw.usage && typeof raw.usage === 'object' ? raw.usage : {}
        }
        const remapped = Array.isArray(raw.accounts)
          ? raw.accounts.some(
              (row) =>
                typeof row?.workspaceKey === 'string' && isEphemeralWorkspaceKey(row.workspaceKey)
            )
          : false
        if (remapped) this.persist()
      } else {
        this.data = { ...EMPTY, accounts: [], usage: {} }
      }
    } catch {
      this.data = { accounts: [], usage: {} }
    }
    this.loaded = true
    return this.data.accounts
  }

  list(workspaceKey: string): ProviderAccount[] {
    this.load()
    return this.data.accounts.filter((account) => account.workspaceKey === workspaceKey)
  }

  listAll(): ProviderAccount[] {
    this.load()
    return this.data.accounts
  }

  /** Settings list: every identity, collapsed across workspaces. */
  listVisible(workspaceKey: string): ProviderAccount[] {
    this.load()
    return visibleAccountsForWorkspace(this.data.accounts, workspaceKey)
  }

  get(id: string): ProviderAccount | undefined {
    this.load()
    return this.data.accounts.find((account) => account.id === id)
  }

  currentVav(workspaceKey: string): ProviderAccount | undefined {
    this.load()
    const local = this.list(workspaceKey).find((account) => account.provider === 'vav' && account.current)
    if (local) return local
    const all = this.data.accounts.filter(
      (account) => account.provider === 'vav' || agentIdOf(account) === 'vav'
    )
    if (all.length === 0) return undefined
    return all.find((account) => account.current) ?? preferVisibleAccount(all, workspaceKey)
  }

  seedIfNeeded(input: {
    workspaceKey: string
    endpoint: string | null
    hasApiKey: boolean
  }): ProviderAccount | null {
    this.load()
    const existing = this.data.accounts.filter(
      (account) => account.provider === 'vav' || agentIdOf(account) === 'vav'
    )
    if (existing.length > 0) {
      return this.currentVav(input.workspaceKey) ?? preferVisibleAccount(existing, input.workspaceKey)
    }
    if (!input.hasApiKey) return null
    const account = seedWorkspaceAccount({
      id: randomUUID(),
      workspaceKey: DEFAULT_WORKSPACE_KEY,
      endpoint: input.endpoint
    })
    this.data.accounts.push(account)
    this.persist()
    return account
  }

  add(
    account: Omit<ProviderAccount, 'id' | 'createdAt' | 'current' | 'alias'> & {
      current?: boolean
      alias?: string | null
    }
  ): ProviderAccount {
    this.load()
    const created: ProviderAccount = {
      alias: null,
      ...account,
      workspaceKey: appWorkspaceKey(account.workspaceKey),
      id: randomUUID(),
      createdAt: Date.now(),
      current: false
    }
    const agentId = agentIdOf(created)
    created.agentId = agentId
    const hasCurrent = this.list(created.workspaceKey).some(
      (row) => agentIdOf(row) === agentId && row.current
    )
    created.current = account.current === true || !hasCurrent
    if (created.current) this.clearCurrent(created.workspaceKey, agentId, created.id)
    this.data.accounts.push(created)
    this.persist()
    return created
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        ProviderAccount,
        | 'name'
        | 'alias'
        | 'endpoint'
        | 'usesLegacyApiKey'
        | 'keyStatus'
        | 'lastUsedAt'
        | 'lastModel'
        | 'oauthHost'
        | 'agentId'
        | 'oauthExpired'
        | 'hasCredentialSnapshot'
        | 'credentialExpiresAtMs'
      >
    >
  ): ProviderAccount | undefined {
    this.load()
    const account = this.data.accounts.find((row) => row.id === id)
    if (!account) return undefined
    Object.assign(account, patch)
    this.persist()
    return account
  }

  setCurrent(id: string, viewingWorkspaceKey?: string): ProviderAccount | undefined {
    this.load()
    const account = this.data.accounts.find((row) => row.id === id)
    if (!account) return undefined
    const agentId = agentIdOf(account)
    this.clearCurrent(account.workspaceKey, agentId, id)
    if (viewingWorkspaceKey && viewingWorkspaceKey !== account.workspaceKey) {
      this.clearCurrent(viewingWorkspaceKey, agentId, id)
    }
    account.current = true
    this.persist()
    return account
  }

  remove(id: string): { removed: ProviderAccount; nextCurrentId: string | null } | undefined {
    this.load()
    const index = this.data.accounts.findIndex((row) => row.id === id)
    if (index < 0) return undefined
    const [removed] = this.data.accounts.splice(index, 1)
    if (!removed) return undefined
    delete this.data.usage[id]
    let nextCurrentId: string | null = null
    if (removed.current) {
      nextCurrentId = nextCurrentAfterDelete(this.data.accounts, id, agentIdOf(removed))
      if (nextCurrentId) {
        const next = this.data.accounts.find((row) => row.id === nextCurrentId)
        if (next) next.current = true
      }
    }
    this.persist()
    return { removed, nextCurrentId }
  }

  recordUsage(
    accountId: string,
    delta: Partial<AccountMonthUsage>,
    at = Date.now()
  ): void {
    this.load()
    if (!this.data.accounts.some((row) => row.id === accountId)) return
    const month = yearMonthOf(at)
    const bucket = this.data.usage[accountId] ?? (this.data.usage[accountId] = {})
    bucket[month] = addUsage(bucket[month] ?? emptyMonthUsage(), delta)
    const account = this.data.accounts.find((row) => row.id === accountId)
    if (account) account.lastUsedAt = at
    this.persist()
  }

  usage(): AccountUsageMap {
    this.load()
    return this.data.usage
  }

  /** Replace monthly totals from retained session snapshots (one add per turn). */
  replaceUsageFromSnapshots(
    snapshots: Array<{
      accountId?: string | null
      timestamp: number
      newInputTokens?: number
      outputTokens?: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
      estimatedCost?: number
    }>
  ): void {
    this.load()
    const next = usageFromSnapshots(snapshots)
    if (JSON.stringify(this.data.usage) === JSON.stringify(next)) return
    this.data.usage = next
    this.persist()
  }

  setKeyStatus(id: string, keyStatus: AccountKeyStatus): void {
    this.update(id, { keyStatus })
  }

  /**
   * CLI login is machine-wide: at most one OAuth profile per agent is signed in.
   * Returns the live row when `signedIn` and a name matches.
   */
  applyLiveOAuth(agentId: string, liveName: string | null, signedIn: boolean): ProviderAccount | null {
    this.load()
    this.data.accounts = applyExclusiveOAuthSignIn(this.data.accounts, agentId, liveName, signedIn)
    this.coalesceOAuthIdentities()
    this.persist()
    return (
      this.data.accounts.find(
        (account) =>
          account.kind === 'oauth' &&
          agentIdOf(account) === agentId &&
          account.keyStatus === 'ok'
      ) ?? null
    )
  }

  /** Fill current only when this host has none — never steal an explicit choice. */
  promoteLiveOAuthCurrent(
    _workspaceKey: string,
    agentId: string,
    liveName: string
  ): ProviderAccount | null {
    this.load()
    const rows = this.data.accounts.filter(
      (account) => account.kind === 'oauth' && agentIdOf(account) === agentId
    )
    const live = rows.find((account) => oauthIdentityMatches(account.name, liveName))
    if (!live) return null
    const current = rows.find((account) => account.current)
    if (current) return live
    this.setCurrent(live.id)
    return this.get(live.id) ?? live
  }

  /** Same agent + email is one profile. Merge usage onto the preferred row. */
  coalesceOAuthIdentities(): void {
    this.load()
    const groups = new Map<string, ProviderAccount[]>()
    for (const account of this.data.accounts) {
      if (account.kind !== 'oauth') continue
      const key = oauthIdentityKey(account)
      const group = groups.get(key)
      if (group) group.push(account)
      else groups.set(key, [account])
    }
    let changed = false
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const keep = preferOAuthAccount(group)
      for (const loser of group) {
        if (loser.id === keep.id) continue
        this.absorbAccount(keep, loser)
        this.data.accounts = this.data.accounts.filter((row) => row.id !== loser.id)
        changed = true
      }
    }
    if (changed) this.persist()
  }

  /** Signed in, but the CLI did not expose an email — keep at most one `ok` row. */
  keepOneOAuthSignedIn(agentId: string): ProviderAccount | null {
    this.load()
    const rows = this.data.accounts.filter(
      (account) => account.kind === 'oauth' && agentIdOf(account) === agentId
    )
    const ok = rows.filter((account) => account.keyStatus === 'ok')
    if (ok.length <= 1) return ok[0] ?? null
    const keep = ok.find((account) => account.current) ?? ok[0]
    if (!keep) return null
    for (const account of rows) {
      if (account.id !== keep.id) account.keyStatus = 'unknown'
    }
    this.persist()
    return keep
  }

  upsertOAuth(input: {
    workspaceKey: string
    provider: AccountProvider
    name: string
    oauthHost: string
    agentId?: string
    signedIn: boolean
    id?: string
  }): ProviderAccount {
    this.load()
    const workspaceKey = appWorkspaceKey(input.workspaceKey)
    const agentId = input.agentId || input.oauthHost
    const sameAgent = this.data.accounts.filter(
      (row) => row.kind === 'oauth' && agentIdOf(row) === agentId && row.oauthHost === input.oauthHost
    )
    const identity =
      sameAgent.find(
        (row) => row.workspaceKey === workspaceKey && oauthIdentityMatches(row.name, input.name)
      ) ?? sameAgent.find((row) => oauthIdentityMatches(row.name, input.name))
    const targeted = input.id ? sameAgent.find((row) => row.id === input.id) : undefined

    if (input.signedIn && identity) {
      if (targeted && targeted.id !== identity.id) {
        this.absorbAccount(identity, targeted)
        this.data.accounts = this.data.accounts.filter((row) => row.id !== targeted.id)
      }
      this.applyLiveOAuth(agentId, input.name, true)
      return this.get(identity.id) ?? identity
    }

    const existing =
      (targeted && canReuseOAuthRow(targeted, input.name) ? targeted : undefined) ??
      identity ??
      (input.signedIn
        ? undefined
        : (sameAgent.find((row) => row.workspaceKey === workspaceKey && row.keyStatus !== 'ok') ??
          sameAgent.find((row) => row.workspaceKey === workspaceKey)))
    if (existing) {
      existing.name = input.name
      existing.agentId = agentId
      if (input.signedIn) {
        this.applyLiveOAuth(agentId, input.name, true)
      } else {
        const wasLive = existing.keyStatus === 'ok'
        existing.keyStatus = 'unknown'
        existing.oauthExpired = wasLive || existing.oauthExpired === true
        this.persist()
      }
      return existing
    }
    const created = this.add({
      workspaceKey,
      agentId,
      provider: input.provider,
      kind: 'oauth',
      name: input.name,
      endpoint: null,
      usesLegacyApiKey: false,
      lastUsedAt: null,
      lastModel: null,
      keyStatus: input.signedIn ? 'ok' : 'unknown',
      oauthHost: input.oauthHost,
      oauthExpired: false
    })
    if (input.signedIn) this.applyLiveOAuth(agentId, input.name, true)
    return created
  }

  private absorbAccount(keep: ProviderAccount, loser: ProviderAccount): void {
    const from = this.data.usage[loser.id]
    if (from) {
      const into = this.data.usage[keep.id] ?? (this.data.usage[keep.id] = {})
      for (const [month, usage] of Object.entries(from)) {
        into[month] = addUsage(into[month] ?? emptyMonthUsage(), usage)
      }
      delete this.data.usage[loser.id]
    }
    if (loser.current && loser.workspaceKey === keep.workspaceKey) keep.current = true
    if ((loser.lastUsedAt ?? 0) > (keep.lastUsedAt ?? 0)) {
      keep.lastUsedAt = loser.lastUsedAt
      keep.lastModel = loser.lastModel
    }
    if (!keep.alias?.trim() && loser.alias?.trim()) keep.alias = loser.alias
  }

  private clearCurrent(workspaceKey: string, agentId: string, exceptId: string): void {
    for (const account of this.data.accounts) {
      if (
        account.workspaceKey === workspaceKey &&
        agentIdOf(account) === agentId &&
        account.id !== exceptId
      ) {
        account.current = false
      }
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`)
    } catch (err) {
      console.error('[accounts] persist failed', err)
    }
  }
}

function canReuseOAuthRow(row: ProviderAccount, name: string): boolean {
  return oauthIdentityMatches(row.name, name) || isGenericAccountIdentity(row.name)
}

function coerceAccount(raw: Partial<ProviderAccount>): ProviderAccount {
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : randomUUID(),
    workspaceKey: appWorkspaceKey(
      typeof raw.workspaceKey === 'string' ? raw.workspaceKey : '__default__'
    ),
    agentId: agentIdOf(raw),
    provider: raw.provider === 'anthropic' || raw.provider === 'openai' || raw.provider === 'custom'
      ? raw.provider
      : 'vav',
    kind: raw.kind === 'oauth' ? 'oauth' : 'vav_key',
    name: typeof raw.name === 'string' && raw.name ? raw.name : '__workspace__',
    alias: typeof raw.alias === 'string' && raw.alias.trim() ? raw.alias.trim().slice(0, 40) : null,
    endpoint: typeof raw.endpoint === 'string' && raw.endpoint ? raw.endpoint : null,
    usesLegacyApiKey: raw.usesLegacyApiKey === true,
    current: raw.current === true,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    lastUsedAt: typeof raw.lastUsedAt === 'number' ? raw.lastUsedAt : null,
    lastModel: typeof raw.lastModel === 'string' ? raw.lastModel : null,
    keyStatus: raw.keyStatus === 'ok' || raw.keyStatus === 'invalid' ? raw.keyStatus : 'unknown',
    oauthHost: typeof raw.oauthHost === 'string' ? raw.oauthHost : null,
    oauthExpired: raw.oauthExpired === true,
    hasCredentialSnapshot: raw.hasCredentialSnapshot === true,
    credentialExpiresAtMs:
      typeof raw.credentialExpiresAtMs === 'number' && Number.isFinite(raw.credentialExpiresAtMs)
        ? raw.credentialExpiresAtMs
        : null
  }
}
