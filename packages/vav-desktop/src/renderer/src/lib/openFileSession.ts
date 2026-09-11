import type { FileSessionListEntry } from '@shared/ipc'
import { tt } from '../i18n/useT'
import { useSessionStore } from '../state/sessionStore'
import type { FileSessionSelectHint } from '../state/sessionListMerge'
import { dirname } from './path'

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
    workingDirectory: dirname(row.path) || null
  }
}

/** Picker → file session + standalone preview. Returns the last opened session id. */
export async function openPickedFileSessions(): Promise<string | null> {
  const picked = await window.vav.files.pickAttachments()
  if (!picked.ok || picked.paths.length === 0) return null
  const { selectConversation, showToast } = useSessionStore.getState()
  let lastId: string | null = null
  let lastHint: FileSessionSelectHint | undefined
  for (const path of picked.paths) {
    let conversationId: string | undefined
    try {
      const state = await window.vav.fileSessions.open(path)
      if (state?.activeSessionId) {
        conversationId = state.activeSessionId
        lastId = state.activeSessionId
        lastHint = {
          fileId: state.fileId,
          title: state.sessions.find((s) => s.id === state.activeSessionId)?.title || 'New session',
          workingDirectory: dirname(path) || null
        }
      }
    } catch (err) {
      showToast({
        kind: 'error',
        title: tt('preview.openFailed'),
        description: String(err)
      })
      continue
    }
    void window.vav.window.openFilePreview(path, {
      origin: 'session',
      conversationId,
      surface: 'file'
    })
  }
  if (lastId) void selectConversation(lastId, lastHint ? { fileSession: lastHint } : undefined)
  return lastId
}

/** Re-open a known file session in the File category surface. */
export function openExistingFileSession(
  path: string,
  conversationId: string,
  hint?: FileSessionSelectHint
): void {
  void window.vav.window.openFilePreview(path, {
    origin: 'session',
    conversationId,
    surface: 'file'
  })
  void useSessionStore.getState().selectConversation(
    conversationId,
    hint ? { fileSession: hint } : undefined
  )
}
