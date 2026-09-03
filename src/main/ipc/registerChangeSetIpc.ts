import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'

export type ChangeSetIpcStore = {
  get: (id: string) => unknown
  activeFor: (conversationId: string) => unknown
  accept: (setId: string, filePaths: string[]) => unknown
  reject: (setId: string, filePaths: string[]) => unknown
  acceptAll: (setId: string) => unknown
  rejectAll: (setId: string) => unknown
  undo: (setId: string, filePath: string) => unknown
  applyEdit: (setId: string, filePath: string, content: string) => unknown
}

/** Accept / reject / edit the pending change-review set. */
export function registerChangeSetIpc(ipcMain: IpcMain, store: ChangeSetIpcStore): void {
  ipcMain.handle(IPC.changeSetGet, (_e, id: string) => store.get(id))
  ipcMain.handle(IPC.changeSetActive, (_e, conversationId: string) => store.activeFor(conversationId))
  ipcMain.handle(IPC.changeSetAccept, (_e, setId: string, filePaths: string[]) =>
    store.accept(setId, filePaths)
  )
  ipcMain.handle(IPC.changeSetReject, (_e, setId: string, filePaths: string[]) =>
    store.reject(setId, filePaths)
  )
  ipcMain.handle(IPC.changeSetAcceptAll, (_e, setId: string) => store.acceptAll(setId))
  ipcMain.handle(IPC.changeSetRejectAll, (_e, setId: string) => store.rejectAll(setId))
  ipcMain.handle(IPC.changeSetUndo, (_e, setId: string, filePath: string) =>
    store.undo(setId, filePath)
  )
  ipcMain.handle(IPC.changeSetApplyEdit, (_e, setId: string, filePath: string, content: string) =>
    store.applyEdit(setId, filePath, content)
  )
}
