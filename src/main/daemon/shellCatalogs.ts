/**
 * Timer / connector catalogs the daemon listen serves to Chrome / web / vav-board.
 * Desktop IPC and vav-server share these wrappers so the side panel matches the workbench.
 */
import {
  connectorCliName,
  isConnectorId,
  type ConnectorActionRequest,
  type ConnectorId
} from '../../shared/connector.ts'
import type { TimerJobInput } from '../../shared/timer.ts'
import { getCloudflareStatus } from '../cloudflare/CloudflareService.ts'
import { clearCloudflareAuthCache, peekCloudflareAuth } from '../cloudflare/wranglerAuth.ts'
import {
  cancelConnectorLogin,
  currentConnectorLogin,
  finishConnectorLogin,
  resolveConnectorLoginLaunch,
  startConnectorLogin
} from '../connectors/cliLogin.ts'
import type { ConnectorCreds } from '../connectors/deploy.ts'
import type { ConnectorRegistry } from '../connectors/registry.ts'
import { getVercelStatus } from '../connectors/vercel.ts'
import { clearVercelAuthCache, peekVercelAuth } from '../connectors/vercelAuth.ts'
import { clearGithubTokenCache, peekGithubAuth } from '../github/GithubService.ts'
import { t } from '../i18n.ts'
import { clearSupabaseAuthCache, peekSupabaseAuth } from '../supabase/cliAuth.ts'
import { getSupabaseStatus } from '../supabase/SupabaseService.ts'
import { parseApprovalMode } from '../../shared/remoteSessionControls.ts'
import { parseThinkingLevel } from '../../shared/thinkingLevel.ts'
import { VAV_DEFAULT_MODEL_ID } from '../../shared/types.ts'
import type { ConversationStore } from '../store/ConversationStore.ts'
import type { FileSessionStore } from '../store/FileSessionStore.ts'
import { toFileSessionsState } from '../store/fileSessionsState.ts'
import type { SettingsStore } from '../store/SettingsStore.ts'
import type { TimerStore } from '../store/TimerStore.ts'
import type { TimerScheduler } from '../timer/TimerScheduler.ts'
import type { ChangeSetStore } from '../agent/ChangeSetStore.ts'
import type {
  DaemonChangeSetCatalog,
  DaemonConnectorCatalog,
  DaemonFileSessionCatalog,
  DaemonTimerCatalog
} from './DaemonServer.ts'

export function createFileSessionCatalog(opts: {
  store: FileSessionStore
  conversations: ConversationStore
  settings: SettingsStore
}): DaemonFileSessionCatalog {
  const defaults = (): [string, 'auto' | 'bypass' | 'edit', ReturnType<typeof parseThinkingLevel>] => {
    const snap = opts.settings.get()
    return [
      snap.defaultModel || VAV_DEFAULT_MODEL_ID,
      parseApprovalMode(snap.defaultApprovalMode) ?? 'auto',
      parseThinkingLevel(snap.defaultThinkingLevel)
    ]
  }
  const stateOf = (fileId: string, activeSessionId: string, sessions: Array<{ id: string; title: string; createdAt: number; updatedAt: number }>) =>
    toFileSessionsState(
      fileId,
      activeSessionId,
      sessions.map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
    )
  return {
    open: async (path) => {
      try {
        const [model, approval, thinking] = defaults()
        const opened = await opts.store.open(path, model, approval, thinking)
        return stateOf(opened.fileId, opened.activeSessionId, opened.sessions)
      } catch {
        return null
      }
    },
    create: async (path) => {
      try {
        const [model, approval, thinking] = defaults()
        const created = await opts.store.createSession(path, model, approval, thinking)
        return stateOf(created.fileId, created.activeSessionId, created.sessions)
      } catch {
        return null
      }
    },
    setActive: (fileId, sessionId) => {
      const sessions = opts.store.setActive(fileId, sessionId)
      if (!sessions) return null
      const listed = opts.store.list(fileId)
      if (!listed) return null
      return stateOf(fileId, listed.activeSessionId, sessions)
    },
    list: (fileId) => {
      const listed = opts.store.list(fileId)
      if (!listed) return null
      return stateOf(fileId, listed.activeSessionId, listed.sessions)
    },
    listAll: () => opts.store.listAll(),
    resolve: (fileId) => opts.store.resolve(fileId),
    rename: (fileId, sessionId, title) => {
      const sessions = opts.store.rename(fileId, sessionId, title)
      if (!sessions) return null
      const listed = opts.store.list(fileId)
      if (!listed) return null
      return stateOf(fileId, listed.activeSessionId, sessions)
    },
    delete: (fileId, sessionIds) => {
      const result = opts.store.deleteSessions(fileId, sessionIds)
      if (!result) return null
      return {
        ok: result.ok,
        error: result.error,
        removed: result.removed,
        fileId,
        activeSessionId: result.activeSessionId,
        sessions: result.sessions.map((row) => ({
          id: row.id,
          title: row.title,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        }))
      }
    },
    forceDelete: (fileId, sessionIds) => opts.store.forceDelete(fileId, sessionIds),
    setReadOnly: (sessionId, readOnly) => {
      opts.conversations.updateMeta(sessionId, { fileReadOnly: readOnly })
    }
  }
}

export function createTimerCatalog(opts: {
  store: TimerStore
  scheduler: () => TimerScheduler | null
  conversations: ConversationStore
  createScheduled: () => unknown
}): DaemonTimerCatalog {
  return {
    listJobs: () => opts.store.listJobs(),
    createScheduled: () => opts.createScheduled(),
    getJobForConversation: (conversationId) =>
      opts.store.getJobForConversation(conversationId) ?? null,
    createJob: (input) => opts.store.createJob(input as TimerJobInput),
    updateJob: (id, patch) =>
      opts.store.updateJob(id, patch as Partial<TimerJobInput> & { enabled?: boolean }),
    removeJob: (id) => {
      const job = opts.store.getJob(id)
      const ok = opts.store.removeJob(id)
      if (ok && job?.conversationId) {
        opts.conversations.remove([job.conversationId])
      }
      return ok
    },
    runNow: (id) => opts.scheduler()?.runNow(id) ?? null,
    listRuns: (jobId) => opts.store.listRuns(jobId),
    listSessions: () => opts.conversations.listTimerMeta()
  }
}

export function createConnectorCatalog(opts: {
  registry: ConnectorRegistry
  creds: () => ConnectorCreds
}): DaemonConnectorCatalog {
  const statusQuery = (query: unknown): { remote?: boolean } | undefined =>
    query && typeof query === 'object' && (query as { remote?: unknown }).remote === false
      ? { remote: false }
      : undefined

  const authPage = () => opts.registry.authPage(currentConnectorLogin())

  return {
    catalog: () => opts.registry.catalog(),
    probe: (cwd) => opts.registry.probe(cwd),
    act: (request) => opts.registry.act(request as ConnectorActionRequest),
    authStatus: () => authPage(),
    beginLogin: async (id) => {
      if (!isConnectorId(id)) {
        return { rows: [], login: { connector: null, status: 'error', message: t('connector.loginFailed') } }
      }
      const launch = resolveConnectorLoginLaunch(id)
      if ('error' in launch) {
        return {
          rows: [],
          login: { connector: id, status: 'error', message: t('connector.cliMissing', { cli: connectorCliName(id) }) }
        }
      }
      try {
        startConnectorLogin({
          connector: id,
          onFinished: (result) => {
            void (async () => {
              if (result.cancelled) return
              if (result.exitCode !== 0) {
                finishConnectorLogin(id, 'error', t('connector.loginFailed'))
                return
              }
              await new Promise((resolve) => setTimeout(resolve, 400))
              clearGithubTokenCache()
              clearCloudflareAuthCache()
              clearSupabaseAuthCache()
              clearVercelAuthCache()
              const ok = await connectorSignedIn(id)
              finishConnectorLogin(id, ok ? 'ok' : 'error', ok ? undefined : t('connector.loginFailed'))
            })()
          }
        })
      } catch {
        return {
          rows: [],
          login: { connector: id, status: 'error', message: t('connector.cliMissing', { cli: connectorCliName(id) }) }
        }
      }
      return authPage()
    },
    cancelLogin: async (id) => {
      cancelConnectorLogin(id && isConnectorId(id) ? id : undefined)
      return authPage()
    },
    cloudflareStatus: (cwd, query) => getCloudflareStatus(cwd, opts.creds().cloudflare, statusQuery(query)),
    supabaseStatus: (cwd, query) => getSupabaseStatus(cwd, opts.creds().supabase, statusQuery(query)),
    vercelStatus: (cwd, query) => getVercelStatus(cwd, opts.creds().vercel, statusQuery(query))
  }
}

export function createChangeSetCatalog(
  store: ChangeSetStore,
  seedReview?: (conversationId: string) => Promise<unknown>
): DaemonChangeSetCatalog {
  return {
    get: (id) => store.get(id),
    active: (conversationId) => store.activeFor(conversationId),
    seedReview,
    accept: (setId, filePaths) => store.accept(setId, filePaths),
    reject: (setId, filePaths) => store.reject(setId, filePaths),
    acceptAll: (setId) => store.acceptAll(setId),
    rejectAll: (setId) => store.rejectAll(setId),
    undo: (setId, filePath) => store.undo(setId, filePath),
    applyEdit: (setId, filePath, content) => store.applyEdit(setId, filePath, content)
  }
}

async function connectorSignedIn(id: ConnectorId): Promise<boolean> {
  if (id === 'github') return (await peekGithubAuth()).present
  if (id === 'cloudflare') return peekCloudflareAuth(null).present
  if (id === 'supabase') return (await peekSupabaseAuth(null)).present
  return peekVercelAuth(null).present
}
