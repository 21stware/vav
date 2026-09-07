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

export type ChangeSetIpcRemote = {
  request: (method: string, params?: unknown) => Promise<unknown>
}

/** Accept / reject / edit the pending change-review set. */
export function registerChangeSetIpc(
  ipcMain: IpcMain,
  store: ChangeSetIpcStore,
  remote?: () => ChangeSetIpcRemote | null
): void {
  const via = (): ChangeSetIpcRemote | null => remote?.() ?? null
  ipcMain.handle(IPC.changeSetGet, async (_e, id: string) => {
    const client = via()
    if (client) return client.request('changeSets.get', { id })
    return store.get(id)
  })
  ipcMain.handle(IPC.changeSetActive, async (_e, conversationId: string) => {
    const client = via()
    if (client) return client.request('changeSets.active', { conversationId })
    return store.activeFor(conversationId)
  })
  ipcMain.handle(IPC.changeSetAccept, async (_e, setId: string, filePaths: string[]) => {
    const client = via()
    if (client) return client.request('changeSets.accept', { setId, filePaths })
    return store.accept(setId, filePaths)
  })
  ipcMain.handle(IPC.changeSetReject, async (_e, setId: string, filePaths: string[]) => {
    const client = via()
    if (client) return client.request('changeSets.reject', { setId, filePaths })
    return store.reject(setId, filePaths)
  })
  ipcMain.handle(IPC.changeSetAcceptAll, async (_e, setId: string) => {
    const client = via()
    if (client) return client.request('changeSets.acceptAll', { setId })
    return store.acceptAll(setId)
  })
  ipcMain.handle(IPC.changeSetRejectAll, async (_e, setId: string) => {
    const client = via()
    if (client) return client.request('changeSets.rejectAll', { setId })
    return store.rejectAll(setId)
  })
  ipcMain.handle(IPC.changeSetUndo, async (_e, setId: string, filePath: string) => {
    const client = via()
    if (client) return client.request('changeSets.undo', { setId, filePath })
    return store.undo(setId, filePath)
  })
  ipcMain.handle(IPC.changeSetApplyEdit, async (_e, setId: string, filePath: string, content: string) => {
    const client = via()
    if (client) return client.request('changeSets.applyEdit', { setId, filePath, content })
    return store.applyEdit(setId, filePath, content)
  })
}
