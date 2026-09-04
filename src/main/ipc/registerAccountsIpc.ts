import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { IPC, type AccountActivateResult, type AccountsPagePayload } from '@shared/ipc'
import { DEFAULT_CLI_AGENTS } from '@shared/types'
import {
  createKindForAgent,
  defaultKeyEndpoint,
  isHttpUrl,
  isOAuthSyncAgent,
  nameConflict,
  nextDraftName,
  normalizeAccountName,
  providerForAgent,
  agentIdOf,
  DEFAULT_WORKSPACE_KEY,
  type ProviderAccount
} from '@shared/accounts'
import { isStructuredCliHost } from '@shared/cliHost'
import { accountSecret } from '../accounts/service'
import { activateAccount, captureAccountCredentials, captureLiveHost } from '../accounts/activateAccount'
import { loginArgv } from '../accounts/hostLoginArgv'
import { t } from '../i18n'
import type { AccountStore } from '../store/AccountStore'
import type { SecretStore } from '../store/SecretStore'

export type AccountsIpcHost = {
  page: (workspaceKey?: string | null) => AccountsPagePayload
  refreshPage: (workspaceKey?: string | null, force?: boolean) => Promise<AccountsPagePayload>
  settings: () => { apiEndpoint: string; cliAgents?: Array<{ id: string }> | null }
  validateKey: (
    endpoint: string,
    apiKey: string
  ) => Promise<{ ok: boolean; authFailed?: boolean; message: string }>
  retargetEmpty: (account: ProviderAccount, workspaceKey: string) => void
  broadcastSettings: () => void
  rememberLiveOAuth: (host: string, name: string | null) => void
  clearHostAuth: () => void
  refreshQuotaHosts: (hosts: string[], force: boolean) => void
  hostMayHaveQuota: (host: string) => boolean
  clearApiBalance: (id: string) => void
  confirmRevealSecret: (event: IpcMainInvokeEvent) => Promise<boolean>
  resolveExecutable: (host: string) => string | null
  readHostAccount: (host: string) => Promise<{ signedIn: boolean; accountId?: string | null }>
  startOAuth: (input: {
    agentId: string
    accountId?: string
    resolved: string
    onFinished: (result: { cancelled: boolean; exitCode: number | null }) => void
  }) => void
  cancelOAuth: (host: string) => void
  finishOAuth: (host: string, status: 'ok' | 'error' | 'cancelled', message?: string) => void
  runLogout: (resolved: string, host: string) => Promise<void>
  refreshQuotaPanel: (host: string) => void
}

/** Provider account CRUD, verify/reveal, and host OAuth login. */
export function registerAccountsIpc(
  ipcMain: IpcMain,
  accounts: AccountStore,
  secrets: SecretStore,
  host: AccountsIpcHost
): void {
  ipcMain.handle(
    IPC.accountsGetPage,
    async (
      _event,
      workspaceKey?: string | null,
      options?: { refresh?: boolean; force?: boolean }
    ) => {
      if (options?.refresh) return host.refreshPage(workspaceKey, options.force === true)
      return host.page(workspaceKey)
    }
  )
  ipcMain.handle(
    IPC.accountsCreateVav,
    async (
      _event,
      input: {
        name: string
        endpoint: string
        apiKey: string
        agentId?: string
        provider?: 'vav' | 'custom'
      }
    ) => {
      const page = await host.page()
      const name = normalizeAccountName(input.name ?? '')
      const endpoint = (input.endpoint ?? '').trim()
      const apiKey = (input.apiKey ?? '').trim()
      const agentId = input.agentId?.trim() || 'vav'
      const provider = input.provider === 'custom' ? 'custom' : providerForAgent(agentId)
      if (!name) return Promise.reject(new Error(t('accounts.error.nameRequired')))
      if (nameConflict(accounts.listAll(), agentId, name)) {
        return Promise.reject(new Error(t('accounts.error.nameTaken')))
      }
      if (!isHttpUrl(endpoint)) return Promise.reject(new Error(t('accounts.error.endpoint')))
      if (!apiKey) return Promise.reject(new Error(t('error.noApiKeyShort')))
      const check = await host.validateKey(endpoint, apiKey)
      if (!check.ok) return Promise.reject(new Error(check.message))
      const created = accounts.add({
        workspaceKey: DEFAULT_WORKSPACE_KEY,
        agentId,
        provider,
        kind: 'vav_key',
        name,
        endpoint,
        usesLegacyApiKey: false,
        lastUsedAt: null,
        lastModel: null,
        keyStatus: 'ok',
        oauthHost: null
      })
      secrets.setAccountKey(created.id, apiKey)
      return host.page(page.workspaceKey)
    }
  )
  ipcMain.handle(
    IPC.accountsCreateDraft,
    async (
      _event,
      input: { agentId: string; kind?: 'vav_key' | 'oauth'; endpoint?: string }
    ) => {
      const page = await host.page()
      const agentId = input.agentId?.trim() || 'vav'
      const kind = input.kind === 'oauth' ? 'oauth' : 'vav_key'
      if (kind === 'oauth' && createKindForAgent(agentId) !== 'oauth') {
        return Promise.reject(new Error(t('accounts.error.missing')))
      }
      const name = nextDraftName(accounts.listAll(), agentId, t('accounts.draftName'))
      const endpoint =
        kind === 'vav_key'
          ? input.endpoint !== undefined
            ? input.endpoint.trim() || null
            : defaultKeyEndpoint(agentId, host.settings().apiEndpoint || '')
          : null
      const created = accounts.add({
        workspaceKey: DEFAULT_WORKSPACE_KEY,
        agentId,
        provider: providerForAgent(agentId),
        kind,
        name,
        endpoint: endpoint || null,
        usesLegacyApiKey: false,
        lastUsedAt: null,
        lastModel: null,
        keyStatus: 'unknown',
        oauthHost: kind === 'oauth' ? agentId : null
      })
      return { page: await host.page(page.workspaceKey), id: created.id }
    }
  )
  ipcMain.handle(
    IPC.accountsUpdateVav,
    async (
      _event,
      id: string,
      patch: { alias?: string | null; endpoint?: string; apiKey?: string }
    ) => {
      const account = accounts.get(id)
      if (!account) {
        return Promise.reject(new Error(t('accounts.error.missing')))
      }
      if (patch.alias !== undefined) {
        const alias = patch.alias == null ? '' : normalizeAccountName(patch.alias)
        accounts.update(id, { alias: alias || null })
      }
      if (account.kind !== 'vav_key' && (patch.endpoint != null || patch.apiKey != null)) {
        return Promise.reject(new Error(t('accounts.error.missing')))
      }
      if (patch.endpoint != null) {
        const endpoint = patch.endpoint.trim()
        if (!isHttpUrl(endpoint)) return Promise.reject(new Error(t('accounts.error.endpoint')))
        accounts.update(id, { endpoint })
      }
      if (patch.apiKey != null) {
        const key = patch.apiKey.trim()
        if (!key) return Promise.reject(new Error(t('error.noApiKeyShort')))
        secrets.setAccountKey(id, key)
        accounts.update(id, { usesLegacyApiKey: false, keyStatus: 'unknown' })
      }
      host.broadcastSettings()
      return host.page(account.workspaceKey)
    }
  )
  ipcMain.handle(IPC.accountsSetCurrent, (_event, id: string) => {
    const viewing = host.page().workspaceKey
    const account = accounts.setCurrent(id, viewing)
    if (account) host.retargetEmpty(account, viewing)
    host.broadcastSettings()
    return host.page(viewing)
  })
  ipcMain.handle(IPC.accountsActivate, async (_event, id: string) => {
    const viewing = host.page().workspaceKey
    const result: AccountActivateResult = await activateAccount({
      accountId: id,
      accounts,
      secrets
    })
    if (result.kind === 'switched' || result.kind === 'alreadyLive') {
      const account = accounts.setCurrent(id, viewing)
      if (account) host.retargetEmpty(account, viewing)
      const live = accounts.get(id)
      const oauthHost = live?.oauthHost ?? (live ? agentIdOf(live) : null)
      if (oauthHost && live) host.rememberLiveOAuth(oauthHost, live.name)
      host.clearHostAuth()
      if (oauthHost && host.hostMayHaveQuota(oauthHost)) {
        host.refreshQuotaHosts([oauthHost], true)
      }
    }
    host.broadcastSettings()
    return { page: host.page(viewing), result }
  })
  ipcMain.handle(IPC.accountsRemove, (_event, id: string) => {
    const result = accounts.remove(id)
    if (result) {
      secrets.clearAccountKey(id)
      secrets.clearOAuthSnapshot(id)
      host.clearApiBalance(id)
    }
    host.broadcastSettings()
    return host.page(result?.removed.workspaceKey)
  })
  ipcMain.handle(IPC.accountsVerify, async (_event, id: string, apiKey?: string) => {
    const account = accounts.get(id)
    if (!account || account.kind !== 'vav_key') {
      return { ok: false, message: t('accounts.error.missing') }
    }
    const key = apiKey?.trim() || accountSecret(account, secrets)
    const endpoint = account.endpoint?.trim() || host.settings().apiEndpoint
    if (!key) return { ok: false, message: t('error.noApiKeyShort') }
    const result = await host.validateKey(endpoint, key)
    accounts.setKeyStatus(id, result.ok ? 'ok' : result.authFailed ? 'invalid' : 'unknown')
    return { ok: result.ok, message: result.message, authFailed: result.authFailed }
  })
  ipcMain.handle(IPC.accountsRevealKey, async (event, id: string) => {
    if (!(await host.confirmRevealSecret(event))) return null
    const account = accounts.get(id)
    if (!account || account.kind !== 'vav_key') return null
    if (account.usesLegacyApiKey) return secrets.get('api')
    return secrets.getAccountKey(id)
  })
  ipcMain.handle(IPC.accountsBeginOAuth, async (_event, agentId: string, accountId?: string) => {
    const oauthHost = agentId.trim()
    const name = DEFAULT_CLI_AGENTS.find((agent) => agent.id === oauthHost)?.name ?? oauthHost
    if (
      !isStructuredCliHost(oauthHost) ||
      createKindForAgent(oauthHost) !== 'oauth' ||
      !loginArgv(oauthHost)
    ) {
      return Promise.reject(new Error(t('accounts.error.missing')))
    }
    const resolved = host.resolveExecutable(oauthHost)
    if (!resolved) {
      return Promise.reject(new Error(t('accounts.error.cliMissing', { name })))
    }
    const targetId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : undefined
    try {
      const live = await host.readHostAccount(oauthHost)
      if (live.signedIn) {
        const email = live.accountId?.trim()
        if (email) {
          accounts.upsertOAuth({
            workspaceKey: host.page().workspaceKey,
            agentId: oauthHost,
            provider: providerForAgent(oauthHost),
            name: email,
            oauthHost,
            signedIn: true
          })
        }
        await captureLiveHost(oauthHost, email ?? null, accounts, secrets)
      }
    } catch {
      // Still start OAuth — an empty or unreadable slot just means nothing to keep.
    }
    host.startOAuth({
      agentId: oauthHost,
      accountId: targetId,
      resolved,
      onFinished: (result) => {
        void (async () => {
          host.clearHostAuth()
          if (result.cancelled) return
          if (result.exitCode !== 0) {
            host.finishOAuth(oauthHost, 'error', t('accounts.oauthFailedBody'))
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 400))
          try {
            const info = await host.readHostAccount(oauthHost)
            if (!info.signedIn && !info.accountId) {
              host.finishOAuth(oauthHost, 'error', t('accounts.oauthFailedBody'))
              return
            }
            const page = host.page()
            const email = info.accountId?.trim() || name
            const saved = accounts.upsertOAuth({
              id: targetId,
              workspaceKey: page.workspaceKey,
              agentId: oauthHost,
              provider: providerForAgent(oauthHost),
              name: email,
              oauthHost,
              signedIn: info.signedIn
            })
            if (info.signedIn) {
              await captureAccountCredentials(saved.id, accounts, secrets)
            }
            host.rememberLiveOAuth(oauthHost, info.signedIn ? email : null)
            host.finishOAuth(oauthHost, 'ok')
            host.refreshQuotaPanel(oauthHost)
          } catch {
            host.finishOAuth(oauthHost, 'error', t('accounts.oauthFailedBody'))
          }
        })()
      }
    })
    return host.page()
  })
  ipcMain.handle(IPC.accountsCancelOAuth, async (_event, agentId: string) => {
    host.cancelOAuth(String(agentId ?? '').trim())
    return host.page()
  })
  ipcMain.handle(IPC.accountsSignOut, async (_event, agentId: string) => {
    const oauthHost = agentId.trim()
    if (!isStructuredCliHost(oauthHost) || !isOAuthSyncAgent(oauthHost)) {
      return Promise.reject(new Error(t('accounts.error.missing')))
    }
    const resolved = host.resolveExecutable(oauthHost)
    if (resolved) {
      try {
        await host.runLogout(resolved, oauthHost)
      } catch {
        // Still drop the local signed-in mark.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
    host.clearHostAuth()
    accounts.applyLiveOAuth(oauthHost, null, false)
    host.rememberLiveOAuth(oauthHost, null)
    return host.page()
  })
}
