import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { isFileSessionEligible } from '@shared/clipPath'
import { parseThinkingLevel } from '@shared/thinkingLevel'
import type { ApprovalMode, ThinkingLevel } from '@shared/types'
import { toFileSessionsState, type FileSessionRow } from '../store/fileSessionsState'

export type { FileSessionRow }
export { toFileSessionsState }

export type FileSessionsIpcStore = {
  open: (
    path: string,
    model: string,
    approvalMode: ApprovalMode,
    thinkingLevel: ThinkingLevel
  ) => Promise<{ fileId: string; activeSessionId: string; sessions: FileSessionRow[] }>
  createSession: (
    path: string,
    model: string,
    approvalMode: ApprovalMode,
    thinkingLevel: ThinkingLevel
  ) => Promise<{ fileId: string; activeSessionId: string; sessions: FileSessionRow[] }>
  setActive: (fileId: string, sessionId: string) => FileSessionRow[] | null
  list: (fileId: string) => { activeSessionId: string; sessions: FileSessionRow[] } | null
  listAll: () => unknown
  resolve: (fileId: string) => unknown
  forceDelete: (fileId: string, sessionIds: string[]) => unknown
  rename: (fileId: string, sessionId: string, title: string) => FileSessionRow[] | null
  deleteSessions: (
    fileId: string,
    sessionIds: string[]
  ) => {
    ok: boolean
    error?: string
    removed: string[]
    activeSessionId: string
    sessions: FileSessionRow[]
  } | null
}

export type FileSessionsIpcHost = {
  defaultModel: () => string
  defaultApprovalMode: () => ApprovalMode
  defaultThinkingLevel: () => string | undefined
  setReadOnly: (sessionId: string, readOnly: boolean) => void
  onSessionsDeleted: (ids: string[]) => void
}

/** File-preview multi-session store — hidden from the main sidebar. */
export function registerFileSessionsIpc(
  ipcMain: IpcMain,
  store: FileSessionsIpcStore,
  host: FileSessionsIpcHost
): void {
  const defaults = (): [string, ApprovalMode, ThinkingLevel] => [
    host.defaultModel(),
    host.defaultApprovalMode(),
    parseThinkingLevel(host.defaultThinkingLevel())
  ]

  ipcMain.handle(IPC.fileSessionsOpen, async (_event, path: string) => {
    if (!isFileSessionEligible(path)) return null
    const [model, approval, thinking] = defaults()
    const opened = await store.open(path, model, approval, thinking)
    return toFileSessionsState(opened.fileId, opened.activeSessionId, opened.sessions)
  })

  ipcMain.handle(IPC.fileSessionsCreate, async (_event, path: string) => {
    if (!isFileSessionEligible(path)) return null
    const [model, approval, thinking] = defaults()
    const created = await store.createSession(path, model, approval, thinking)
    return toFileSessionsState(created.fileId, created.activeSessionId, created.sessions)
  })

  ipcMain.handle(IPC.fileSessionsSetActive, (_event, fileId: string, sessionId: string) => {
    const sessions = store.setActive(fileId, sessionId)
    if (!sessions) return null
    return toFileSessionsState(fileId, sessionId, sessions)
  })

  ipcMain.handle(IPC.fileSessionsList, (_event, fileId: string) => {
    const listed = store.list(fileId)
    if (!listed) return null
    return toFileSessionsState(fileId, listed.activeSessionId, listed.sessions)
  })
  ipcMain.handle(IPC.fileSessionsListAll, () => store.listAll())
  ipcMain.handle(IPC.fileSessionsResolve, (_event, fileId: string) => store.resolve(fileId))
  ipcMain.handle(IPC.fileSessionsForceDelete, (_event, fileId: string, sessionIds: string[]) =>
    store.forceDelete(fileId, sessionIds)
  )

  ipcMain.handle(IPC.fileSessionsSetReadOnly, (_event, sessionId: string, readOnly: boolean) => {
    host.setReadOnly(sessionId, readOnly)
  })

  ipcMain.handle(
    IPC.fileSessionsRename,
    (_event, fileId: string, sessionId: string, title: string) => {
      const sessions = store.rename(fileId, sessionId, title)
      if (!sessions) return null
      const listed = store.list(fileId)
      if (!listed) return null
      return toFileSessionsState(fileId, listed.activeSessionId, sessions)
    }
  )

  ipcMain.handle(IPC.fileSessionsDelete, (_event, fileId: string, sessionIds: string[]) => {
    const result = store.deleteSessions(fileId, sessionIds)
    if (!result) return null
    host.onSessionsDeleted(result.removed)
    return {
      ok: result.ok,
      error: result.error,
      removed: result.removed,
      fileId,
      activeSessionId: result.activeSessionId,
      sessions: result.sessions
    }
  })
}
