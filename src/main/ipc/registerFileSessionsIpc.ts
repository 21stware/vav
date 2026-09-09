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

export type FileSessionsIpcRemote = {
  request: (method: string, params?: unknown) => Promise<unknown>
}

export type FileSessionsIpcHost = {
  defaultModel: () => string
  defaultApprovalMode: () => ApprovalMode
  defaultThinkingLevel: () => string | undefined
  setReadOnly: (sessionId: string, readOnly: boolean) => void
  onSessionsDeleted: (ids: string[]) => void
  /** Spawned loopback vav-server — File Preview talks to the same index Chrome uses. */
  remote?: () => FileSessionsIpcRemote | null
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

  const remote = (): FileSessionsIpcRemote | null => host.remote?.() ?? null

  ipcMain.handle(IPC.fileSessionsOpen, async (_event, path: string) => {
    if (!isFileSessionEligible(path)) return null
    const client = remote()
    if (client) return client.request('fileSessions.open', { path })
    const [model, approval, thinking] = defaults()
    const opened = await store.open(path, model, approval, thinking)
    return toFileSessionsState(opened.fileId, opened.activeSessionId, opened.sessions)
  })

  ipcMain.handle(IPC.fileSessionsCreate, async (_event, path: string) => {
    if (!isFileSessionEligible(path)) return null
    const client = remote()
    if (client) return client.request('fileSessions.create', { path })
    const [model, approval, thinking] = defaults()
    const created = await store.createSession(path, model, approval, thinking)
    return toFileSessionsState(created.fileId, created.activeSessionId, created.sessions)
  })

  ipcMain.handle(IPC.fileSessionsSetActive, async (_event, fileId: string, sessionId: string) => {
    const client = remote()
    if (client) return client.request('fileSessions.setActive', { fileId, sessionId })
    const sessions = store.setActive(fileId, sessionId)
    if (!sessions) return null
    return toFileSessionsState(fileId, sessionId, sessions)
  })

  ipcMain.handle(IPC.fileSessionsList, async (_event, fileId: string) => {
    const client = remote()
    if (client) return client.request('fileSessions.list', { fileId })
    const listed = store.list(fileId)
    if (!listed) return null
    return toFileSessionsState(fileId, listed.activeSessionId, listed.sessions)
  })
  ipcMain.handle(IPC.fileSessionsListAll, async () => {
    const client = remote()
    if (client) return client.request('fileSessions.listAll')
    return store.listAll()
  })
  ipcMain.handle(IPC.fileSessionsResolve, async (_event, fileId: string) => {
    const client = remote()
    if (client) return client.request('fileSessions.resolve', { fileId })
    return store.resolve(fileId)
  })
  ipcMain.handle(IPC.fileSessionsForceDelete, async (_event, fileId: string, sessionIds: string[]) => {
    const client = remote()
    if (client) {
      const result = (await client.request('fileSessions.forceDelete', { fileId, sessionIds })) as {
        removed?: string[]
      } | null
      host.onSessionsDeleted(result?.removed ?? sessionIds)
      return result
    }
    return store.forceDelete(fileId, sessionIds)
  })

  ipcMain.handle(IPC.fileSessionsSetReadOnly, async (_event, sessionId: string, readOnly: boolean) => {
    const client = remote()
    if (client) await client.request('fileSessions.setReadOnly', { sessionId, readOnly })
    host.setReadOnly(sessionId, readOnly)
  })

  ipcMain.handle(
    IPC.fileSessionsRename,
    async (_event, fileId: string, sessionId: string, title: string) => {
      const client = remote()
      if (client) return client.request('fileSessions.rename', { fileId, sessionId, title })
      const sessions = store.rename(fileId, sessionId, title)
      if (!sessions) return null
      const listed = store.list(fileId)
      if (!listed) return null
      return toFileSessionsState(fileId, listed.activeSessionId, sessions)
    }
  )

  ipcMain.handle(IPC.fileSessionsDelete, async (_event, fileId: string, sessionIds: string[]) => {
    const client = remote()
    if (client) {
      const result = (await client.request('fileSessions.delete', { fileId, sessionIds })) as {
        ok?: boolean
        error?: string
        removed?: string[]
        activeSessionId?: string
        sessions?: unknown
      } | null
      if (!result) return null
      host.onSessionsDeleted(result.removed ?? [])
      return {
        ok: result.ok,
        error: result.error,
        removed: result.removed,
        fileId,
        activeSessionId: result.activeSessionId,
        sessions: result.sessions
      }
    }
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
