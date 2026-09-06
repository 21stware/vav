/**
 * Product session kinds. Transcripts still live in ConversationStore —
 * these flags keep special sessions off the main sidebar, same as fileId.
 *
 * - chat: ordinary sidebar session
 * - file: File Preview (fileId set)
 * - timer: scheduled run (timerJobId set)
 */
export type SessionKind = 'chat' | 'file' | 'timer'

export function sessionKindOf(row: {
  fileId?: string | null
  timerJobId?: string | null
}): SessionKind {
  if (row.fileId) return 'file'
  if (row.timerJobId) return 'timer'
  return 'chat'
}

/** Main / archive lists: not file sessions, not timer sessions. */
export function isMainSidebarSession(row: {
  fileId?: string | null
  timerJobId?: string | null
}): boolean {
  return sessionKindOf(row) === 'chat'
}
