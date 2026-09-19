import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'

export type FaaaaastIpcController = {
  ask: (request: unknown) => Promise<unknown>
  cancel: () => void
  hide: () => void
  resize: (height: unknown) => void
}

export function registerFaaaaastIpc(ipcMain: IpcMain, controller: FaaaaastIpcController): void {
  ipcMain.handle(IPC.faaaaastAsk, (_event, request) => controller.ask(request))
  ipcMain.on(IPC.faaaaastCancel, () => controller.cancel())
  ipcMain.on(IPC.faaaaastDismiss, () => controller.hide())
  ipcMain.on(IPC.faaaaastResize, (_event, height) => controller.resize(height))
}
