import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC, type SettingsView } from '@shared/ipc'
import {
  MAIN_WINDOW_MIN_HEIGHT,
  PIP_WINDOW_MIN_HEIGHT,
  PIP_WINDOW_MIN_WIDTH,
  WINDOW_MIN_WIDTH_FLOOR
} from '@shared/shellMinSize'
import { applyWindowMinSize } from '@main/window/applyWindowMinSize'
import type { AppSettings, ShellKind } from '@shared/types'
import type { OverlayPayload } from '@shared/overlayOpen'

export type WindowIpcActions = {
  applyTheme: (theme: AppSettings['theme']) => void
  accentColor: () => string
  shellPath: (kind: ShellKind) => unknown
  openSettings: (view: SettingsView, agentId?: string, machineId?: string) => void
  settingsDesiredView: () => unknown
  hideSettings: () => void
  openSession: (id: string) => void
  revealInList: (event: IpcMainInvokeEvent, id: string) => Promise<void>
  setPictureInPicture: (enabled: boolean) => void
  isPictureInPicture: () => boolean
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
  openRemoteFolder: (sender: IpcMainInvokeEvent['sender'], request: unknown) => void
  remoteFolderView: () => unknown
  chooseRemoteFolder: (sender: IpcMainInvokeEvent['sender'], path: unknown) => void
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
  ipcMain.handle(
    IPC.windowOpenSettings,
    (_event, view?: SettingsView, agentId?: string, machineId?: string) =>
      actions.openSettings(
        view ?? 'appearance',
        typeof agentId === 'string' ? agentId : undefined,
        typeof machineId === 'string' ? machineId : undefined
      )
  )
  ipcMain.handle(IPC.settingsDesiredView, () => actions.settingsDesiredView())
  ipcMain.handle(IPC.windowCloseSettings, () => actions.hideSettings())
  ipcMain.handle(IPC.windowOpenSession, (_event, id: string) => {
    void actions.openSession(String(id || ''))
  })
  ipcMain.handle(IPC.windowRevealInList, async (event, id: string) => {
    await actions.revealInList(event, String(id || ''))
  })
  ipcMain.handle(IPC.windowSetPictureInPicture, (_event, enabled: unknown) => {
    actions.setPictureInPicture(enabled === true)
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
  ipcMain.handle(IPC.windowOpenRemoteFolder, (event, request: unknown) => {
    actions.openRemoteFolder(event.sender, request)
  })
  ipcMain.handle(IPC.remoteFolderGetView, () => actions.remoteFolderView())
  ipcMain.handle(IPC.remoteFolderChoose, (event, path: unknown) => {
    actions.chooseRemoteFolder(event.sender, path)
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
  ipcMain.handle(IPC.windowSetMinSize, (event, size: { width?: unknown; height?: unknown }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    const pip = actions.isPictureInPicture()
    const widthFloor = pip ? PIP_WINDOW_MIN_WIDTH : WINDOW_MIN_WIDTH_FLOOR
    const heightFloor = pip ? PIP_WINDOW_MIN_HEIGHT : MAIN_WINDOW_MIN_HEIGHT
    const width =
      typeof size?.width === 'number' && Number.isFinite(size.width)
        ? Math.max(widthFloor, Math.round(size.width))
        : widthFloor
    const height =
      typeof size?.height === 'number' && Number.isFinite(size.height)
        ? Math.max(heightFloor, Math.round(size.height))
        : heightFloor
    applyWindowMinSize(win, width, height)
  })
}
