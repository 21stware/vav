import type { IpcMain } from 'electron'
import { IPC, type HostDiscoveryPeer } from '@shared/ipc'
import { hostJoin, isLocalMachine, LOCAL_MACHINE_ID, normalizeMachineId } from '@shared/workspaceHost'
import { decorateHosts } from '../host/decorateHosts'
import { mapHostDirectoryEntries } from '../host/hostDirList'
import { safeSend } from '../window/safeSend'
import type { HostRegistry } from '../host/WorkspaceHost'
import type { DaemonAttachService } from '../daemon/DaemonAttachService'

export type HostsIpcWindows = {
  show: (machineId: string) => void | Promise<void>
  close: (machineId: string) => void
  of: (machineId: string) => {
    isDestroyed: () => boolean
    webContents: { isDestroyed: () => boolean; send: (channel: string, payload?: unknown) => void }
  } | null
  applyDefaultMachine: (id: string) => void
  defaultMachineId: () => string | undefined
  localHome: () => string
  broadcastHosts: () => void
}

/** Pair / forget / browse remote machines. */
export function registerHostsIpc(
  ipcMain: IpcMain,
  registry: HostRegistry,
  attach: DaemonAttachService,
  windows: HostsIpcWindows
): void {
  ipcMain.handle(IPC.hostsList, () => decorateHosts(registry.list(), attach))
  ipcMain.handle(IPC.hostsPairing, () => attach.pairing())
  ipcMain.handle(IPC.hostsPair, async (_event, payload: string) => {
    const result = await attach.pair(String(payload || ''))
    if (result.ok) await windows.show(result.host.id)
    return result
  })
  ipcMain.handle(IPC.hostsPairLan, async (_event, peer: HostDiscoveryPeer) => {
    const result = await attach.pairLan({
      address: String(peer?.address || ''),
      port: Number(peer?.port) || 0,
      name: typeof peer?.name === 'string' ? peer.name : undefined,
      machineId: typeof peer?.machineId === 'string' ? peer.machineId : undefined
    })
    if (result.ok) await windows.show(result.host.id)
    return result
  })
  ipcMain.handle(IPC.hostsCancelPair, () => {
    attach.cancelPair()
  })
  ipcMain.on(IPC.hostsCancelPair, () => {
    attach.cancelPair()
  })
  ipcMain.handle(IPC.hostsForget, (_event, machineId: string) => {
    const id = String(machineId || '')
    attach.forget(id)
    windows.close(id)
    if (windows.defaultMachineId() === id) windows.applyDefaultMachine(LOCAL_MACHINE_ID)
  })
  ipcMain.handle(IPC.hostsDiscovered, () => attach.listDiscovered())
  ipcMain.handle(IPC.hostsHome, (_event, machineId: string) => {
    if (isLocalMachine(machineId)) return windows.localHome()
    return attach.homeOf(machineId)
  })
  ipcMain.handle(IPC.hostsShow, (_event, machineId: string) => {
    void windows.show(machineId)
  })
  ipcMain.handle(IPC.hostsOpenFolder, async (_event, machineId: string) => {
    const id = normalizeMachineId(machineId)
    await windows.show(id)
    const win = windows.of(id)
    if (win && !win.isDestroyed()) safeSend(win.webContents, IPC.hostsPickFolder, id)
  })
  ipcMain.handle(IPC.hostsProbeProviders, async (_event, machineId: string) => {
    const id = String(machineId || '')
    if (!id || isLocalMachine(id)) return []
    const found = await attach.probeProviders(id)
    windows.broadcastHosts()
    return found
  })
  ipcMain.handle(IPC.hostsListDir, async (_event, machineId: string, path: string) => {
    const host = registry.get(normalizeMachineId(machineId)) ?? registry.hostFor(machineId)
    if (!host.info.online) {
      return { path, entries: [], truncated: 0, error: `${host.info.name} is offline` }
    }
    try {
      const dirents = await host.fs.readdir(path)
      const entries = mapHostDirectoryEntries(path, dirents, (...parts) =>
        hostJoin(host.info.platform, ...parts)
      )
      return { path, entries, truncated: 0 }
    } catch (err) {
      return { path, entries: [], truncated: 0, error: (err as Error).message }
    }
  })
}
