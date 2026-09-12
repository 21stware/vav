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
  mode: 'fileSessions' | 'databases',
  hint?: FileSessionSelectHint
): Promise<void> {
  const store = useSessionStore.getState()
  store.setSidebarListMode(mode)
  await store.selectConversation(conversationId, hint ? { fileSession: hint } : undefined)
}

/** Open or create a file session for `path` and show it in the File category. */
export async function openFileSessionFromPath(path: string): Promise<string | null> {
  const { showToast } = useSessionStore.getState()
  try {
    if (typeof window.vav.db?.list === 'function') {
      const dbId = dbConversationIdForFilePath(await window.vav.db.list(), path)
      if (dbId) {
        await revealInMainShell(dbId, 'databases')
        return dbId
      }
    }
    const state = await window.vav.fileSessions.open(path)
    if (!state?.activeSessionId) return null
    const hint: FileSessionSelectHint = {
      fileId: state.fileId,
      title: state.sessions.find((s) => s.id === state.activeSessionId)?.title || 'New session',
      workingDirectory: dirname(path) || null,
      machineId: normalizeMachineId(useSessionStore.getState().windowMachineId)
    }
    await revealInMainShell(state.activeSessionId, 'fileSessions', hint)
    return state.activeSessionId
  } catch (err) {
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
  hint?: FileSessionSelectHint
): void {
  void (async () => {
    try {
      if (typeof window.vav.db?.list === 'function') {
        const dbId = dbConversationIdForFilePath(await window.vav.db.list(), path)
        if (dbId) {
          await revealInMainShell(dbId, 'databases')
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
    await revealInMainShell(conversationId, 'fileSessions', hint)
  })()
}
