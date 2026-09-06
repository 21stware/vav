import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { ConnectorActionRequest } from '@shared/connector'
import type { ConnectorRegistry } from '../connectors/registry'
import { getVercelStatus } from '../connectors/vercel'
import type { VercelStatusQuery } from '@shared/vercel'

export function registerConnectorIpc(
  ipcMain: IpcMain,
  registry: ConnectorRegistry,
  vercelAuth: () => { token: string | null }
): void {
  ipcMain.handle(IPC.connectorsCatalog, () => registry.catalog())
  ipcMain.handle(IPC.connectorsProbe, (_event, cwd: string) => registry.probe(String(cwd || '')))
  ipcMain.handle(IPC.connectorsAct, (_event, request: ConnectorActionRequest) => registry.act(request))
  ipcMain.handle(
    IPC.vercelStatus,
    (_event, cwd: string, query?: VercelStatusQuery) =>
      getVercelStatus(
        String(cwd || ''),
        vercelAuth(),
        query && typeof query === 'object' ? { remote: query.remote !== false } : undefined
      )
  )
}
