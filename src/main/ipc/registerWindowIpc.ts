import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { IPC, type SettingsView } from '@shared/ipc'
import type { AppSettings, ShellKind } from '@shared/types'
import type { OverlayPayload } from '@shared/overlayOpen'

export type WindowIpcActions = {
  applyTheme: (theme: AppSettings['theme']) => void
  accentColor: () => string
  shellPath: (kind: ShellKind) => unknown
  openSettings: (view: SettingsView, agentId?: string) => void
  settingsDesiredView: () => unknown
  hideSettings: () => void
  openConnect: () => void
  hideConnect: () => void
  fitConnect: (height: number) => void
  openSession: (id: string) => void
  revealInList: (event: IpcMainInvokeEvent, id: string) => Promise<void>
  closeDetached: (id: string) => void
  newDetached: () => void
  listDetached: () => string[]
  openFilePreview: (
    path: string,
    options?: { origin?: 'dock' | 'session'; conversationId?: string; surface?: 'file' | 'app' }
  ) => void
  openOverlay: (payload: OverlayPayload) => void
  openTokenUsage: (
    sender: IpcMainInvokeEvent['sender'],
    conversationId: string,
    anchor?: { x: number; y: number; width: number; height: number }
  ) => void
  tokenUsageView: () => unknown
  openProviderAccount: (
    sender: IpcMainInvokeEvent['sender'],
    conversationId: string,
    anchor?: { x: number; y: number; width: number; height: number }
  ) => void
  providerAccountView: () => unknown
  fitProviderAccount: (height: number) => void
  openSwarmHistory: (
    sender: IpcMainInvokeEvent['sender'],
    conversationId: string,
    anchor?: { x: number; y: number; width: number; height: number }
  ) => void
  relaunch: () => void
}

/** Settings / connect / companion / overlay window IPC. */
export function registerWindowIpc(ipcMain: IpcMain, actions: WindowIpcActions): void {
  ipcMain.handle(IPC.windowSetTheme, (_event, theme: AppSettings['theme']) =>
    actions.applyTheme(theme)
  )
  ipcMain.handle(IPC.windowGetAccentColor, () => actions.accentColor())
  ipcMain.handle(IPC.windowShellPath, (_event, kind: ShellKind) => actions.shellPath(kind))
  ipcMain.handle(IPC.windowOpenSettings, (_event, view?: SettingsView, agentId?: string) =>
    actions.openSettings(view ?? 'appearance', typeof agentId === 'string' ? agentId : undefined)
  )
  ipcMain.handle(IPC.settingsDesiredView, () => actions.settingsDesiredView())
  ipcMain.handle(IPC.windowCloseSettings, () => actions.hideSettings())
  ipcMain.handle(IPC.windowOpenConnect, () => actions.openConnect())
  ipcMain.handle(IPC.windowCloseConnect, () => actions.hideConnect())
  ipcMain.handle(IPC.windowFitConnect, (_event, height: unknown) => {
    if (typeof height !== 'number' || !Number.isFinite(height)) return
    actions.fitConnect(height)
  })
  ipcMain.handle(IPC.windowOpenSession, (_event, id: string) => {
    void actions.openSession(String(id || ''))
  })
  ipcMain.handle(IPC.windowRevealInList, async (event, id: string) => {
    await actions.revealInList(event, String(id || ''))
  })
  ipcMain.handle(IPC.windowCloseDetached, (_event, id: string) => {
    actions.closeDetached(String(id || ''))
  })
  ipcMain.handle(IPC.windowNewDetached, () => actions.newDetached())
  ipcMain.handle(IPC.windowListDetached, () => actions.listDetached())
  ipcMain.handle(
    IPC.windowOpenFilePreview,
    (
      _event,
      path: string,
      options?: { origin?: 'dock' | 'session'; conversationId?: string; surface?: 'file' | 'app' }
    ) => actions.openFilePreview(path, options)
  )
  ipcMain.handle(IPC.windowOpenOverlay, (_event, payload: OverlayPayload) => {
    if (!payload || typeof payload !== 'object') return
    actions.openOverlay(payload)
  })
  ipcMain.handle(
    IPC.windowOpenTokenUsage,
    (
      event,
      conversationId: string,
      anchor?: { x: number; y: number; width: number; height: number }
    ) => actions.openTokenUsage(event.sender, conversationId, anchor)
  )
  ipcMain.handle(IPC.tokenUsageGetView, () => actions.tokenUsageView())
  ipcMain.handle(
    IPC.windowOpenProviderAccount,
    (
      event,
      conversationId: string,
      anchor?: { x: number; y: number; width: number; height: number }
    ) => actions.openProviderAccount(event.sender, conversationId, anchor)
  )
  ipcMain.handle(IPC.providerAccountGetView, () => actions.providerAccountView())
  ipcMain.handle(IPC.providerAccountFit, (_event, height: unknown) => {
    if (typeof height !== 'number' || !Number.isFinite(height)) return
    actions.fitProviderAccount(height)
  })
  ipcMain.handle(
    IPC.windowOpenSwarmHistory,
    (
      event,
      conversationId: string,
      anchor?: { x: number; y: number; width: number; height: number }
    ) => actions.openSwarmHistory(event.sender, conversationId, anchor)
  )
  ipcMain.handle(IPC.windowRelaunch, () => actions.relaunch())
}
