import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc'

export type ScreenshotIpcController = {
  start: (event: IpcMainInvokeEvent) => unknown
  ready: (event: IpcMainEvent) => void
  painted: (event: IpcMainEvent) => void
  dismiss: () => void
  finish: (payload: { ok: true; path: string } | { ok: false }) => void
  setKey: (event: IpcMainEvent, on: boolean) => void
}

/** Region capture overlay — start/ready/paint/dismiss/finish. */
export function registerScreenshotIpc(
  ipcMain: IpcMain,
  controller: ScreenshotIpcController
): void {
  ipcMain.handle(IPC.filesCaptureScreenshot, (event) => controller.start(event))
  ipcMain.on(IPC.screenshotReady, (event) => controller.ready(event))
  ipcMain.on(IPC.screenshotPainted, (event) => controller.painted(event))
  ipcMain.on(IPC.screenshotDismiss, () => controller.dismiss())
  ipcMain.on(IPC.screenshotFinish, (_event, payload) => controller.finish(payload))
  ipcMain.on(IPC.screenshotSetKey, (event, on: boolean) => controller.setKey(event, on))
}
