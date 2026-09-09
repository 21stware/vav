import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { shell, systemPreferences } from 'electron'
import { IPC } from '@shared/ipc'

/** macOS System Settings deep-link to Privacy → Screen Recording. */
const SCREEN_RECORDING_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

export type ScreenshotIpcController = {
  start: (event: IpcMainInvokeEvent, options?: { hideWindows?: boolean }) => unknown
  ready: (event: IpcMainEvent) => void
  painted: (event: IpcMainEvent) => void
  dismiss: () => void
  finish: (payload: { ok: true; path: string } | { ok: false }) => void
  setKey: (event: IpcMainEvent, on: boolean) => void
}

function captureOptions(raw: unknown): { hideWindows?: boolean } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  return (raw as { hideWindows?: boolean }).hideWindows === true
    ? { hideWindows: true }
    : undefined
}

/** Region capture overlay — start/ready/paint/dismiss/finish. */
export function registerScreenshotIpc(
  ipcMain: IpcMain,
  controller: ScreenshotIpcController
): void {
  ipcMain.handle(IPC.filesCaptureScreenshot, (event, options) =>
    controller.start(event, captureOptions(options))
  )
  ipcMain.on(IPC.screenshotReady, (event) => controller.ready(event))
  ipcMain.on(IPC.screenshotPainted, (event) => controller.painted(event))
  ipcMain.on(IPC.screenshotDismiss, () => controller.dismiss())
  ipcMain.on(IPC.screenshotFinish, (_event, payload) => controller.finish(payload))
  ipcMain.on(IPC.screenshotSetKey, (event, on: boolean) => controller.setKey(event, on))

  ipcMain.handle(IPC.filesScreenshotPermission, () => {
    if (process.platform !== 'darwin') return 'granted'
    return systemPreferences.getMediaAccessStatus('screen')
  })
  ipcMain.handle(IPC.filesOpenScreenshotPermissionSettings, async () => {
    if (process.platform !== 'darwin') return
    await shell.openExternal(SCREEN_RECORDING_SETTINGS_URL)
  })
}
