import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { parseAgentBinaryCandidates, parseAgentProbeSpecs } from '../agent/probeSpecs'

export type AgentsIpcHost = {
  resolveBinary: (candidates: string[], force: boolean) => unknown
  probeLocal: (
    specs: Array<{ id: string; candidates: string[] }>,
    force: boolean
  ) => unknown
  probeRemote: (
    machineId: string,
    specs: Array<{ id: string; candidates: string[] }>,
    force: boolean
  ) => Promise<Record<string, string | null>>
  isLocalMachine: (machineId?: string | null) => boolean
  listModels: (host: string | null, force?: boolean) => unknown
  getCatalog: () => unknown
  preloadModels: (force?: boolean) => Promise<unknown>
  startInstall: (payload: { agentId: string; name: string; command: string }) => unknown
  cancelInstall: (agentId: string) => void
  clearInstall: (agentId: string) => void
  listInstallRuns: () => unknown
}

/** CLI binary probe, model catalogue, and agent installer IPC. */
export function registerAgentsIpc(ipcMain: IpcMain, host: AgentsIpcHost): void {
  ipcMain.handle(
    IPC.agentsResolveBinary,
    (_event, candidates: string[], force?: boolean) =>
      host.resolveBinary(parseAgentBinaryCandidates(candidates), force === true)
  )

  ipcMain.handle(
    IPC.agentsProbeBinaries,
    async (_event, items: unknown, force?: boolean, machineId?: string) => {
      const specs = parseAgentProbeSpecs(items)
      if (machineId && !host.isLocalMachine(machineId)) {
        return host.probeRemote(machineId, specs, force === true)
      }
      return host.probeLocal(specs, force === true)
    }
  )

  ipcMain.handle(IPC.agentsListModels, (_event, hostId: string | null, force?: boolean) =>
    host.listModels(hostId, force)
  )

  ipcMain.handle(IPC.agentsGetModelCatalog, () => host.getCatalog())

  ipcMain.handle(IPC.agentsPreloadModels, async (_event, force?: boolean) =>
    host.preloadModels(force)
  )

  ipcMain.handle(
    IPC.agentsInstallStart,
    (_event, payload: { agentId?: string; name?: string; command?: string }) =>
      host.startInstall({
        agentId: typeof payload?.agentId === 'string' ? payload.agentId : '',
        name: typeof payload?.name === 'string' ? payload.name : '',
        command: typeof payload?.command === 'string' ? payload.command : ''
      })
  )
  ipcMain.handle(IPC.agentsInstallCancel, (_event, agentId: string) => {
    host.cancelInstall(String(agentId || ''))
  })
  ipcMain.handle(IPC.agentsInstallClear, (_event, agentId: string) => {
    host.clearInstall(String(agentId || ''))
  })
  ipcMain.handle(IPC.agentsListInstallRuns, () => host.listInstallRuns())
}
