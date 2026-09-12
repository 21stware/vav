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

export type RemoteFileSessionSeed = {
  sessionId: string
  fileId: string
  path: string
  title: string
}

export type FileSessionsIpcHost = {
  defaultModel: () => string
  defaultApprovalMode: () => ApprovalMode
  defaultThinkingLevel: () => string | undefined
  setReadOnly: (sessionId: string, readOnly: boolean) => void
  onSessionsDeleted: (ids: string[]) => void
  /** Sidebar + other windows should re-list after create / rename / delete. */
  onChanged?: () => void
  /**
   * Active window's daemon. Local loopback vav-server, or the paired remote
   * the main shell is currently showing.
   */
  remote?: () => FileSessionsIpcRemote | null
  /**
   * Paired remote window: never fall back to this computer's file-session
   * index when the host client is missing.
   */
  remoteOnly?: () => boolean
  /** Keep Electron conversation rows so file IO routes to that host. */
  rememberRemoteSessions?: (rows: RemoteFileSessionSeed[]) => void
}

function asRemoteState(value: unknown): {
  fileId?: string
  activeSessionId?: string
  sessions?: Array<{ id?: string; title?: string }>
} | null {
  if (!value || typeof value !== 'object') return null
  return value as {
    fileId?: string
    activeSessionId?: string
    sessions?: Array<{ id?: string; title?: string }>
  }
}

function asListRows(value: unknown): RemoteFileSessionSeed[] {
  if (!Array.isArray(value)) return []
  const out: RemoteFileSessionSeed[] = []
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const rec = row as {
      sessionId?: unknown
      fileId?: unknown
      path?: unknown
      title?: unknown
    }
    if (typeof rec.sessionId !== 'string' || typeof rec.fileId !== 'string') continue
    if (typeof rec.path !== 'string') continue
    out.push({
      sessionId: rec.sessionId,
      fileId: rec.fileId,
      path: rec.path,
      title: typeof rec.title === 'string' ? rec.title : 'New session'
    })
  }
  return out
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
  const remoteOnly = (): boolean => host.remoteOnly?.() === true
  const remember = (rows: RemoteFileSessionSeed[]): void => {
    if (rows.length) host.rememberRemoteSessions?.(rows)
  }
  const notifyChanged = (): void => {
    host.onChanged?.()
  }
  const rememberOpened = (path: string, value: unknown): unknown => {
    const state = asRemoteState(value)
    if (state?.fileId && state.activeSessionId) {
      const title =
        state.sessions?.find((row) => row.id === state.activeSessionId)?.title?.trim() ||
        'New session'
      remember([{ sessionId: state.activeSessionId, fileId: state.fileId, path, title }])
    }
    notifyChanged()
    return value
  }

  ipcMain.handle(IPC.fileSessionsOpen, async (_event, path: string) => {
    if (!isFileSessionEligible(path)) return null
    const client = remote()
    if (client) return rememberOpened(path, await client.request('fileSessions.open', { path }))
    if (remoteOnly()) return null
    const [model, approval, thinking] = defaults()
    const opened = await store.open(path, model, approval, thinking)
    notifyChanged()
    return toFileSessionsState(opened.fileId, opened.activeSessionId, opened.sessions)
  })

  ipcMain.handle(IPC.fileSessionsCreate, async (_event, path: string) => {
    if (!isFileSessionEligible(path)) return null
    const client = remote()
    if (client) return rememberOpened(path, await client.request('fileSessions.create', { path }))
    if (remoteOnly()) return null
    const [model, approval, thinking] = defaults()
    const created = await store.createSession(path, model, approval, thinking)
    notifyChanged()
    return toFileSessionsState(created.fileId, created.activeSessionId, created.sessions)
  })

  ipcMain.handle(IPC.fileSessionsSetActive, async (_event, fileId: string, sessionId: string) => {
    const client = remote()
    if (client) {
      const result = await client.request('fileSessions.setActive', { fileId, sessionId })
      notifyChanged()
      return result
    }
    if (remoteOnly()) return null
    const sessions = store.setActive(fileId, sessionId)
    if (!sessions) return null
    notifyChanged()
    return toFileSessionsState(fileId, sessionId, sessions)
  })

  ipcMain.handle(IPC.fileSessionsList, async (_event, fileId: string) => {
    const client = remote()
    if (client) return client.request('fileSessions.list', { fileId })
    if (remoteOnly()) return null
    const listed = store.list(fileId)
    if (!listed) return null
    return toFileSessionsState(fileId, listed.activeSessionId, listed.sessions)
  })
  ipcMain.handle(IPC.fileSessionsListAll, async () => {
    const client = remote()
    if (client) {
      const listed = await client.request('fileSessions.listAll')
      remember(asListRows(listed))
      return listed
    }
    if (remoteOnly()) return []
    return store.listAll()
  })
  ipcMain.handle(IPC.fileSessionsResolve, async (_event, fileId: string) => {
    const client = remote()
    if (client) return client.request('fileSessions.resolve', { fileId })
    if (remoteOnly()) return null
    return store.resolve(fileId)
  })
  ipcMain.handle(IPC.fileSessionsForceDelete, async (_event, fileId: string, sessionIds: string[]) => {
    const client = remote()
    if (client) {
      const result = (await client.request('fileSessions.forceDelete', { fileId, sessionIds })) as {
        removed?: string[]
      } | null
      host.onSessionsDeleted(result?.removed ?? sessionIds)
      notifyChanged()
      return result
    }
    if (remoteOnly()) return { ok: true, removed: [] }
    const removed = store.forceDelete(fileId, sessionIds)
    notifyChanged()
    return removed
  })

  ipcMain.handle(IPC.fileSessionsSetReadOnly, async (_event, sessionId: string, readOnly: boolean) => {
    const client = remote()
    if (client) await client.request('fileSessions.setReadOnly', { sessionId, readOnly })
    if (!remoteOnly() || client) host.setReadOnly(sessionId, readOnly)
  })

  ipcMain.handle(
    IPC.fileSessionsRename,
    async (_event, fileId: string, sessionId: string, title: string) => {
      const client = remote()
      if (client) {
        const result = await client.request('fileSessions.rename', { fileId, sessionId, title })
        notifyChanged()
        return result
      }
      if (remoteOnly()) return null
      const sessions = store.rename(fileId, sessionId, title)
      if (!sessions) return null
      const listed = store.list(fileId)
      if (!listed) return null
      notifyChanged()
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
      notifyChanged()
      return {
        ok: result.ok,
        error: result.error,
        removed: result.removed,
        fileId,
        activeSessionId: result.activeSessionId,
        sessions: result.sessions
      }
    }
    if (remoteOnly()) return null
    const result = store.deleteSessions(fileId, sessionIds)
    if (!result) return null
    host.onSessionsDeleted(result.removed)
    notifyChanged()
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
