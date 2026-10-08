import type { FileSessionListEntry } from '@shared/ipc'
import { tt } from '../i18n/useT'
import { useSessionStore } from '../state/sessionStore'
import type { FileSessionSelectHint } from '../state/sessionListMerge'
import { dbConversationIdForFilePath } from './fileViewerHelpers'
import { dirname } from './path'
import { normalizeMachineId } from '@shared/workspaceHost'

export function fileSessionSelectHint(
  row: Pick<
    FileSessionListEntry,
    'fileId' | 'title' | 'createdAt' | 'updatedAt' | 'tokensUsed' | 'path'
  >
): FileSessionSelectHint {
  return {
    fileId: row.fileId,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    tokensUsed: row.tokensUsed,
    workingDirectory: dirname(row.path) || null,
    machineId: normalizeMachineId(useSessionStore.getState().windowMachineId)
  }
}

async function revealInMainShell(
  conversationId: string,
  _mode: 'fileSessions' | 'databases',
  hint?: FileSessionSelectHint,
  peek = false
): Promise<void> {
  const store = useSessionStore.getState()
  await store.selectConversation(conversationId, {
    ...(hint ? { fileSession: hint } : {}),
    ...(peek ? { appPeek: true } : {})
  })
}

async function browseIfDirectory(path: string): Promise<boolean> {
  try {
    const info = await window.vav.files.inspect(path)
    if (info.kind === 'directory') {
      useSessionStore.getState().browseStoragePath(path)
      return true
    }
  } catch {
    // Missing / unreadable: treat as a file session.
  }
  return false
}

/** Latest peek wins — a slower earlier click must not steal the side panel. */
let peekSeq = 0

/**
 * Open or create a file session for `path` and show it in the File category.
 * `peek` focuses it for the wide app column's side panel instead of opening
 * the full layer (selectConversation on an app object already does that —
 * callers must not open the detail again).
 */
export async function openFileSessionFromPath(
  path: string,
  opts?: { peek?: boolean }
): Promise<string | null> {
  const peek = opts?.peek === true
  const seq = peek ? ++peekSeq : 0
  const stale = (): boolean => peek && seq !== peekSeq
  const { showToast } = useSessionStore.getState()
  if (!peek && (await browseIfDirectory(path))) return null
  try {
    if (typeof window.vav.db?.list === 'function') {
      const dbId = dbConversationIdForFilePath(await window.vav.db.list(), path)
      if (dbId) {
        // Database files live under Analysis — a peek must not switch tabs.
        if (!peek) await revealInMainShell(dbId, 'databases')
        return dbId
      }
    }
    const state = await window.vav.fileSessions.open(path)
    if (!state?.activeSessionId || stale()) return null
    const hint: FileSessionSelectHint = {
      fileId: state.fileId,
      title: state.sessions.find((s) => s.id === state.activeSessionId)?.title || 'New session',
      workingDirectory: dirname(path) || null,
      machineId: normalizeMachineId(useSessionStore.getState().windowMachineId)
    }
    await revealInMainShell(state.activeSessionId, 'fileSessions', hint, peek)
    return state.activeSessionId
  } catch (err) {
    if (peek) return null
    if (String(err).includes('directory')) {
      useSessionStore.getState().browseStoragePath(path)
      return null
    }
    showToast({
      kind: 'error',
      title: tt('preview.openFailed'),
      description: String(err)
    })
    return null
  }
}

/** Picker → file session in the main File category. Returns the last opened session id. */
export async function openPickedFileSessions(): Promise<string | null> {
  const picked = await window.vav.files.pickAttachments()
  if (!picked.ok || picked.paths.length === 0) return null
  let lastId: string | null = null
  for (const path of picked.paths) {
    lastId = (await openFileSessionFromPath(path)) ?? lastId
  }
  return lastId
}

/** Re-open a known file session in the File category surface. */
export function openExistingFileSession(
  path: string,
  conversationId: string,
  hint?: FileSessionSelectHint,
  opts?: { peek?: boolean }
): void {
  const peek = opts?.peek === true
  const seq = peek ? ++peekSeq : 0
  void (async () => {
    if (await browseIfDirectory(path)) return
    try {
      if (typeof window.vav.db?.list === 'function') {
        const dbId = dbConversationIdForFilePath(await window.vav.db.list(), path)
        if (dbId) {
          // Database files live under Analysis — a peek must not switch tabs.
          if (!peek) await revealInMainShell(dbId, 'databases')
          return
        }
      }
      const opened = await window.vav.fileSessions.open(path)
      if (opened && opened.sessions.some((session) => session.id === conversationId)) {
        await window.vav.fileSessions.setActive(opened.fileId, conversationId)
      }
    } catch {
      // Main-shell FileSessionView still mounts from the sidebar hint.
    }
    // A peek that lost the race to a newer click must not steal focus back.
    if (peek && (seq !== peekSeq || useSessionStore.getState().focusedAppObjectId !== conversationId)) {
      return
    }
    await revealInMainShell(conversationId, 'fileSessions', hint, peek)
  })()
}
