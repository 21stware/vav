import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import {
  connectorCliName,
  isConnectorId,
  type ConnectorActionRequest,
  type ConnectorId
} from '@shared/connector'
import type { ConnectorRegistry } from '../connectors/registry'
import { getVercelStatus } from '../connectors/vercel'
import {
  cancelConnectorLogin,
  currentConnectorLogin,
  finishConnectorLogin,
  resolveConnectorLoginLaunch,
  startConnectorLogin
} from '../connectors/cliLogin'
import { clearCloudflareAuthCache, peekCloudflareAuth } from '../cloudflare/wranglerAuth'
import { clearGithubTokenCache, peekGithubAuth } from '../github/GithubService'
import { clearSupabaseAuthCache, peekSupabaseAuth } from '../supabase/cliAuth'
import { clearVercelAuthCache, peekVercelAuth } from '../connectors/vercelAuth'
import type { VercelStatusQuery } from '@shared/vercel'
import { t } from '../i18n'

export type ConnectorIpcRemote = {
  request: (method: string, params?: unknown) => Promise<unknown>
}

export type ConnectorIpcHost = {
  broadcastSettings: () => void
  /** Spawned loopback vav-server — Settings connectors share the catalog Chrome uses. */
  remote?: () => ConnectorIpcRemote | null
}

function clearConnectorAuthCaches(): void {
  clearGithubTokenCache()
  clearCloudflareAuthCache()
  clearSupabaseAuthCache()
  clearVercelAuthCache()
}

async function connectorSignedIn(id: ConnectorId): Promise<boolean> {
  if (id === 'github') return (await peekGithubAuth()).present
  if (id === 'cloudflare') return peekCloudflareAuth(null).present
  if (id === 'supabase') return (await peekSupabaseAuth(null)).present
  return peekVercelAuth(null).present
}

export function registerConnectorIpc(
  ipcMain: IpcMain,
  registry: ConnectorRegistry,
  vercelAuth: () => { token: string | null },
  host: ConnectorIpcHost
): void {
  const remote = (): ConnectorIpcRemote | null => host.remote?.() ?? null
  const authPage = () => registry.authPage(currentConnectorLogin())

  ipcMain.handle(IPC.connectorsCatalog, async () => {
    const client = remote()
    if (client) return client.request('connectors.catalog')
    return registry.catalog()
  })
  ipcMain.handle(IPC.connectorsProbe, async (_event, cwd: string) => {
    const client = remote()
    if (client) return client.request('connectors.probe', { cwd: String(cwd || '') })
    return registry.probe(String(cwd || ''))
  })
  ipcMain.handle(IPC.connectorsAct, async (_event, request: ConnectorActionRequest) => {
    const client = remote()
    if (client) return client.request('connectors.act', { request })
    return registry.act(request)
  })
  ipcMain.handle(IPC.connectorsAuthStatus, async () => {
    const client = remote()
    if (client) return client.request('connectors.authStatus')
    return authPage()
  })
  ipcMain.handle(IPC.connectorsBeginLogin, async (_event, raw: unknown) => {
    const client = remote()
    if (client) {
      if (!isConnectorId(raw)) {
        return Promise.reject(new Error(t('connector.loginFailed')))
      }
      return client.request('connectors.beginLogin', { id: raw })
    }
    if (!isConnectorId(raw)) {
      return Promise.reject(new Error(t('connector.loginFailed')))
    }
    const launch = resolveConnectorLoginLaunch(raw)
    if ('error' in launch) {
      return Promise.reject(new Error(t('connector.cliMissing', { cli: connectorCliName(raw) })))
    }
    try {
      startConnectorLogin({
        connector: raw,
        onFinished: (result) => {
          void (async () => {
            if (result.cancelled) return
            if (result.exitCode !== 0) {
              finishConnectorLogin(raw, 'error', t('connector.loginFailed'))
              host.broadcastSettings()
              return
            }
            await new Promise((resolve) => setTimeout(resolve, 400))
            clearConnectorAuthCaches()
            const ok = await connectorSignedIn(raw)
            finishConnectorLogin(raw, ok ? 'ok' : 'error', ok ? undefined : t('connector.loginFailed'))
            host.broadcastSettings()
          })()
        }
      })
    } catch {
      return Promise.reject(new Error(t('connector.cliMissing', { cli: connectorCliName(raw) })))
    }
    return authPage()
  })
  ipcMain.handle(IPC.connectorsCancelLogin, async (_event, raw?: unknown) => {
    const client = remote()
    if (client) {
      return client.request('connectors.cancelLogin', {
        id: isConnectorId(raw) ? raw : undefined
      })
    }
    cancelConnectorLogin(isConnectorId(raw) ? raw : undefined)
    return authPage()
  })
  ipcMain.handle(
    IPC.vercelStatus,
    async (_event, cwd: string, query?: VercelStatusQuery) => {
      const client = remote()
      if (client) {
        return client.request('vercel.status', {
          cwd: String(cwd || ''),
          query: query && typeof query === 'object' ? query : undefined
        })
      }
      return getVercelStatus(
        String(cwd || ''),
        vercelAuth(),
        query && typeof query === 'object' ? { remote: query.remote !== false } : undefined
      )
    }
  )
}
