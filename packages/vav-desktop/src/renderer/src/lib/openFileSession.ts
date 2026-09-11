import type { FileSessionListEntry } from '@shared/ipc'
import { tt } from '../i18n/useT'
import { useSessionStore } from '../state/sessionStore'
import type { FileSessionSelectHint } from '../state/sessionListMerge'
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

/** Open or create a file session for `path` and show it in the File category. */
export async function openFileSessionFromPath(path: string): Promise<string | null> {
  const { selectConversation, showToast } = useSessionStore.getState()
  try {
    const state = await window.vav.fileSessions.open(path)
    if (!state?.activeSessionId) return null
    const hint: FileSessionSelectHint = {
      fileId: state.fileId,
      title: state.sessions.find((s) => s.id === state.activeSessionId)?.title || 'New session',
      workingDirectory: dirname(path) || null,
      machineId: normalizeMachineId(useSessionStore.getState().windowMachineId)
    }
    void window.vav.window.openFilePreview(path, {
      origin: 'session',
      conversationId: state.activeSessionId,
      surface: 'file'
    })
    void selectConversation(state.activeSessionId, { fileSession: hint })
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

/** Picker → file session + standalone preview. Returns the last opened session id. */
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
      await window.vav.fileSessions.open(path)
    } catch {
      // Preview still tries; open() also seeds the host conversation row.
    }
    void window.vav.window.openFilePreview(path, {
      origin: 'session',
      conversationId,
      surface: 'file'
    })
    void useSessionStore.getState().selectConversation(
      conversationId,
      hint ? { fileSession: hint } : undefined
    )
  })()
}
