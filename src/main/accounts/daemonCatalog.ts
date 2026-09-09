/**
 * Provider-account catalog the daemon listen serves to Chrome / web / vav-board.
 * Desktop Settings IPC proxies to the same store when local-shell vav-server is up.
 */
import {
  createKindForAgent,
  defaultKeyEndpoint,
  DEFAULT_WORKSPACE_KEY,
  isHttpUrl,
  isOAuthSyncAgent,
  nameConflict,
  nextDraftName,
  normalizeAccountName,
  providerForAgent,
  workspaceKeyOf
} from '../../shared/accounts.ts'
import { isStructuredCliHost } from '../../shared/cliHost.ts'
import { DEFAULT_CLI_AGENTS } from '../../shared/types.ts'
import { t } from '../i18n.ts'
import { validateVavApiKey } from '../agent/vavModelProbe.ts'
import type { ConversationStore } from '../store/ConversationStore.ts'
import type { AccountStore } from '../store/AccountStore.ts'
import type { SecretStore } from '../store/SecretStore.ts'
import type { SettingsStore } from '../store/SettingsStore.ts'
import type { DaemonAccountsCatalog } from '../daemon/DaemonServer.ts'
import { resolveAgentExecutable } from '../terminal/loginPath.ts'
import { accountSecret, clearLegacyApiSlotIfNoVavKeys } from './vavCredentials.ts'
import { buildAccountsPage, cliCatalogOf, resolveWorkspaceContext } from './page.ts'
import { captureAccountCredentials, captureLiveHost } from './activateAccount.ts'
import { adapterFor } from './credentials/index.ts'
import {
  cancelHostOAuthLogin,
  currentOAuthLogin,
  finishHostOAuth,
  loginArgv,
  runHostLogout,
  startHostOAuthLogin
} from './hostLogin.ts'

async function liveOauthIdentity(agentId: string): Promise<string | null> {
  const adapter = adapterFor(agentId)
  if (!adapter) return null
  const live = (await adapter.liveIdentity())?.trim()
  if (live) return live
  return (await adapter.capture())?.identity?.trim() || null
}

const HOST_BINS: Record<string, string[]> = {
  claude: ['claude'],
  codex: ['codex'],
  cursor: ['cursor-agent', 'agent', 'cursor'],
  grok: ['grok'],
  opencode: ['opencode'],
  pi: ['pi', 'pi-agent'],
  devin: ['devin'],
  antigravity: ['agy', 'antigravity'],
  kiro: ['kiro-cli', 'kiro'],
  cline: ['cline']
}

function resolveHostBin(agentId: string, settings: SettingsStore): string | null {
  const agent = settings.get().cliAgents?.find((row) => row.id === agentId)
  const fromSettings = [agent?.binaryPath, ...(agent?.binaryCandidates ?? [])].filter(
    (row): row is string => typeof row === 'string' && row.trim().length > 0
  )
  return resolveAgentExecutable([...fromSettings, ...(HOST_BINS[agentId] ?? [agentId])])
}

export function createAccountsCatalog(opts: {
  accounts: AccountStore
  secrets: SecretStore
  settings: SettingsStore
  conversations: ConversationStore
}): DaemonAccountsCatalog {
  const pageOf = (workspaceKey?: string) => {
    const untitled = t('accounts.workspaceDefault')
    const settings = opts.settings.get()
    const ctx = workspaceKey?.trim()
      ? {
          key: workspaceKey.trim(),
          label:
            workspaceKey.trim() === '__default__'
              ? untitled
              : workspaceKey.trim().split(/[\\/]/).filter(Boolean).at(-1) || untitled
        }
      : resolveWorkspaceContext(opts.conversations.listMeta(), settings, untitled)
    opts.accounts.seedIfNeeded({
      workspaceKey: ctx.key,
      endpoint: settings.apiEndpoint || null,
      hasApiKey: opts.secrets.has('api')
    })
    opts.accounts.coalesceOAuthIdentities()
    return {
      ...buildAccountsPage({
        workspaceKey: ctx.key,
        workspaceLabel: ctx.label,
        accounts: opts.accounts,
        secrets: opts.secrets,
        cliAgents: cliCatalogOf(settings)
      }),
      oauthLogin: currentOAuthLogin()
    }
  }

  const validateKey = async (endpoint: string, apiKey: string) => {
    const probe = await validateVavApiKey(endpoint, apiKey)
    if (probe.ok) return { ok: true as const, authFailed: false, message: t('api.validateOk') }
    const error = probe.error || ''
    return {
      ok: false as const,
      authFailed: probe.authFailed,
      message: probe.authFailed
        ? t('api.validateUnauthorized', { error })
        : t('api.validateFailed', { error })
    }
  }

  const retargetEmpty = (accountId: string, workspaceKey: string) => {
    const account = opts.accounts.get(accountId)
    if (!account || account.kind !== 'oauth') return
    const host = account.agentId
    for (const conversation of opts.conversations.all()) {
      if (conversation.cliHost !== host) continue
      if ((conversation.messages?.length ?? 0) > 0) continue
      if (workspaceKeyOf(conversation.workingDirectory) !== workspaceKey) continue
      if (conversation.accountId === account.id) continue
      opts.conversations.updateMeta(conversation.id, { accountId: account.id })
    }
  }

  return {
    getPage: (workspaceKey) => pageOf(workspaceKey),
    createVav: async (input) => {
      const name = normalizeAccountName(String(input.name ?? ''))
      const endpoint = String(input.endpoint ?? '').trim()
      const apiKey = String(input.apiKey ?? '').trim()
      const agentId = String(input.agentId ?? '').trim() || 'vav'
      const provider = input.provider === 'custom' ? 'custom' : providerForAgent(agentId)
      if (!name) throw new Error(t('accounts.error.nameRequired'))
      if (nameConflict(opts.accounts.listAll(), agentId, name)) {
        throw new Error(t('accounts.error.nameTaken'))
      }
      if (!isHttpUrl(endpoint)) throw new Error(t('accounts.error.endpoint'))
      if (!apiKey) throw new Error(t('error.noApiKeyShort'))
      const check = await validateKey(endpoint, apiKey)
      if (!check.ok) throw new Error(check.message)
      const created = opts.accounts.add({
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
      opts.secrets.setAccountKey(created.id, apiKey)
      return pageOf()
    },
    createDraft: (input) => {
      const agentId = String(input.agentId ?? '').trim() || 'vav'
      const kind = input.kind === 'oauth' ? 'oauth' : 'vav_key'
      if (kind === 'oauth' && createKindForAgent(agentId) !== 'oauth') {
        throw new Error(t('accounts.error.missing'))
      }
      const name = nextDraftName(opts.accounts.listAll(), agentId, t('accounts.draftName'))
      const endpoint =
        kind === 'vav_key'
          ? input.endpoint !== undefined
            ? String(input.endpoint ?? '').trim() || null
            : defaultKeyEndpoint(agentId, opts.settings.get().apiEndpoint || '')
          : null
      const created = opts.accounts.add({
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
      return { page: pageOf(), id: created.id }
    },
    updateVav: (id, patch) => {
      const account = opts.accounts.get(id)
      if (!account) throw new Error(t('accounts.error.missing'))
      if (patch.alias !== undefined) {
        const alias = patch.alias == null ? '' : normalizeAccountName(String(patch.alias))
        opts.accounts.update(id, { alias: alias || null })
      }
      if (account.kind !== 'vav_key' && (patch.endpoint != null || patch.apiKey != null)) {
        throw new Error(t('accounts.error.missing'))
      }
      if (patch.endpoint != null) {
        const endpoint = String(patch.endpoint).trim()
        if (!isHttpUrl(endpoint)) throw new Error(t('accounts.error.endpoint'))
        opts.accounts.update(id, { endpoint })
      }
      if (patch.apiKey != null) {
        const key = String(patch.apiKey).trim()
        if (!key) throw new Error(t('error.noApiKeyShort'))
        opts.secrets.setAccountKey(id, key)
        opts.accounts.update(id, { usesLegacyApiKey: false, keyStatus: 'unknown' })
      }
      return pageOf(account.workspaceKey)
    },
    setCurrent: (id) => {
      const viewing = pageOf().workspaceKey
      const account = opts.accounts.setCurrent(id, viewing)
      if (account) retargetEmpty(account.id, viewing)
      return pageOf(viewing)
    },
    activate: async (id) => {
      const viewing = pageOf().workspaceKey
      const account = opts.accounts.get(id)
      if (!account) return { page: pageOf(viewing), result: { kind: 'needsReauth' as const } }
      opts.accounts.setCurrent(id, viewing)
      retargetEmpty(account.id, viewing)
      return { page: pageOf(viewing), result: { kind: 'switched' as const } }
    },
    remove: (id) => {
      const result = opts.accounts.remove(id)
      if (result) {
        opts.secrets.clearAccountKey(id)
        opts.secrets.clearOAuthSnapshot(id)
        clearLegacyApiSlotIfNoVavKeys(opts.accounts, opts.secrets)
      }
      return pageOf(result?.removed.workspaceKey)
    },
    verify: async (id, apiKey) => {
      const account = opts.accounts.get(id)
      if (!account || account.kind !== 'vav_key') {
        return { ok: false, message: t('accounts.error.missing') }
      }
      const key = apiKey?.trim() || accountSecret(account, opts.secrets)
      const endpoint = account.endpoint?.trim() || opts.settings.get().apiEndpoint
      if (!key) return { ok: false, message: t('error.noApiKeyShort') }
      const result = await validateKey(endpoint, key)
      opts.accounts.setKeyStatus(id, result.ok ? 'ok' : result.authFailed ? 'invalid' : 'unknown')
      return { ok: result.ok, message: result.message, authFailed: result.authFailed }
    },
    revealKey: (id) => {
      const account = opts.accounts.get(id)
      if (!account || account.kind !== 'vav_key') return null
      if (account.usesLegacyApiKey) return opts.secrets.get('api')
      return opts.secrets.getAccountKey(id)
    },
    beginOAuth: async (agentId, accountId) => {
      const oauthHost = agentId.trim()
      const name = DEFAULT_CLI_AGENTS.find((agent) => agent.id === oauthHost)?.name ?? oauthHost
      if (
        !isStructuredCliHost(oauthHost) ||
        createKindForAgent(oauthHost) !== 'oauth' ||
        !loginArgv(oauthHost)
      ) {
        throw new Error(t('accounts.error.missing'))
      }
      const resolved = resolveHostBin(oauthHost, opts.settings)
      if (!resolved) throw new Error(t('accounts.error.cliMissing', { name }))
      const targetId = accountId?.trim() || undefined
      try {
        const email = await liveOauthIdentity(oauthHost)
        if (email) {
          opts.accounts.upsertOAuth({
            workspaceKey: pageOf().workspaceKey,
            agentId: oauthHost,
            provider: providerForAgent(oauthHost),
            name: email,
            oauthHost,
            signedIn: true
          })
          await captureLiveHost(oauthHost, email, opts.accounts, opts.secrets)
        }
      } catch {
        /* still start OAuth */
      }
      startHostOAuthLogin({
        agentId: oauthHost,
        accountId: targetId,
        resolved,
        onFinished: (result) => {
          void (async () => {
            if (result.cancelled) return
            if (result.exitCode !== 0) {
              finishHostOAuth(oauthHost, 'error', t('accounts.oauthFailedBody'))
              return
            }
            await new Promise((resolve) => setTimeout(resolve, 400))
            try {
              const email = (await liveOauthIdentity(oauthHost)) || name
              if (!email) {
                finishHostOAuth(oauthHost, 'error', t('accounts.oauthFailedBody'))
                return
              }
              const page = pageOf()
              const saved = opts.accounts.upsertOAuth({
                id: targetId,
                workspaceKey: page.workspaceKey,
                agentId: oauthHost,
                provider: providerForAgent(oauthHost),
                name: email,
                oauthHost,
                signedIn: true
              })
              await captureAccountCredentials(saved.id, opts.accounts, opts.secrets)
              opts.accounts.applyLiveOAuth(oauthHost, email, true)
              finishHostOAuth(oauthHost, 'ok')
            } catch {
              finishHostOAuth(oauthHost, 'error', t('accounts.oauthFailedBody'))
            }
          })()
        }
      })
      return pageOf()
    },
    cancelOAuth: (agentId) => {
      cancelHostOAuthLogin(String(agentId ?? '').trim())
      return pageOf()
    },
    signOut: async (agentId) => {
      const oauthHost = agentId.trim()
      if (!isStructuredCliHost(oauthHost) || !isOAuthSyncAgent(oauthHost)) {
        throw new Error(t('accounts.error.missing'))
      }
      const resolved = resolveHostBin(oauthHost, opts.settings)
      if (resolved) {
        try {
          await runHostLogout(resolved, oauthHost)
        } catch {
          /* still drop the local signed-in mark */
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
      opts.accounts.applyLiveOAuth(oauthHost, null, false)
      return pageOf()
    }
  }
}
