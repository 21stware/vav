import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc'

export type PreviewShellWindow = {
  isDestroyed: () => boolean
}

export type PreviewShellIpcHost = {
  windowFromEvent: (event: IpcMainInvokeEvent | IpcMainEvent) => PreviewShellWindow | null
  setCloseGuard: (win: PreviewShellWindow, enabled: boolean) => void
  forceClose: (win: PreviewShellWindow) => void
  onPreviewReady: (win: PreviewShellWindow) => void
  onSessionReady: (win: PreviewShellWindow) => void
}

/** Preview/session warm-shell ready and close-guard IPC. */
export function registerPreviewShellIpc(ipcMain: IpcMain, host: PreviewShellIpcHost): void {
  ipcMain.handle(IPC.previewSetCloseGuard, (event, enabled: boolean) => {
    const win = host.windowFromEvent(event)
    if (!win || win.isDestroyed()) return
    host.setCloseGuard(win, enabled)
  })
  ipcMain.handle(IPC.previewForceClose, (event) => {
    const win = host.windowFromEvent(event)
    if (!win || win.isDestroyed()) return
    host.forceClose(win)
  })
  ipcMain.on(IPC.previewShellReady, (event) => {
    const win = host.windowFromEvent(event)
    if (!win || win.isDestroyed()) return
    host.onPreviewReady(win)
  })
  ipcMain.on(IPC.sessionShellReady, (event) => {
    const win = host.windowFromEvent(event)
    if (!win || win.isDestroyed()) return
    host.onSessionReady(win)
  })
}
