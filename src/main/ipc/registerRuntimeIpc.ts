import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { IPC, type NativeMenuItem } from '@shared/ipc'

export type RuntimeIpcHost = {
  notificationsPermission: () => unknown
  remoteControlStatus: () => unknown
  regenerateSecret: () => unknown
  resetIdentity: () => unknown
  windowIdFromEvent: (event: IpcMainEvent) => number | null
  onNotificationsSeen: (conversationId: string, windowId: number) => void
  popupMenu: (
    event: IpcMainInvokeEvent,
    items: NativeMenuItem[],
    position?: { x: number; y: number }
  ) => unknown
  closePopupMenu: () => void
  e2ePeekMenu: () => unknown
  e2eChooseMenu: (idOrLabel: string) => unknown
  e2eDismissMenu: () => void
  updatesGet: () => unknown
  updatesCheck: () => unknown
  updatesOpenDownload: () => unknown
  updatesInstall: () => void
}

/** Notifications, remote-control, native popup, and updater IPC. */
export function registerRuntimeIpc(ipcMain: IpcMain, host: RuntimeIpcHost): void {
  ipcMain.handle(IPC.notificationsPermission, () => host.notificationsPermission())
  ipcMain.handle(IPC.remoteControlStatus, () => host.remoteControlStatus())
  ipcMain.handle(IPC.remoteControlRegenerateSecret, () => host.regenerateSecret())
  ipcMain.handle(IPC.remoteControlResetIdentity, () => host.resetIdentity())
  ipcMain.on(IPC.notificationsSeen, (event, conversationId: unknown) => {
    const id = typeof conversationId === 'string' ? conversationId.trim() : ''
    if (!id) return
    const windowId = host.windowIdFromEvent(event)
    if (windowId == null) return
    host.onNotificationsSeen(id, windowId)
  })
  ipcMain.handle(
    IPC.windowPopupMenu,
    (event, items: NativeMenuItem[], position?: { x: number; y: number }) =>
      host.popupMenu(event, items, position)
  )
  ipcMain.handle(IPC.windowClosePopupMenu, () => {
    host.closePopupMenu()
  })
  ipcMain.handle(IPC.windowE2ePeekMenu, () => host.e2ePeekMenu())
  ipcMain.handle(IPC.windowE2eChooseMenu, (_event, idOrLabel: string) =>
    typeof idOrLabel === 'string' ? host.e2eChooseMenu(idOrLabel) : false
  )
  ipcMain.handle(IPC.windowE2eDismissMenu, () => host.e2eDismissMenu())
  ipcMain.handle(IPC.updatesGet, () => host.updatesGet())
  ipcMain.handle(IPC.updatesCheck, () => host.updatesCheck())
  ipcMain.handle(IPC.updatesOpenDownload, () => host.updatesOpenDownload())
  ipcMain.handle(IPC.updatesInstall, () => {
    host.updatesInstall()
  })
}
