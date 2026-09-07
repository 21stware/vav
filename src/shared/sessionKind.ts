/**
 * Session kinds. Workspace rows are the main sidebar. File and timer
 * conversations share ConversationStore but stay out of listMeta.
 * Timer rows are published via listClientMeta for the scheduled-task panel.
 */
export type SessionKind = 'workspace' | 'file' | 'timer'

export function sessionKindOf(row: {
  fileId?: string | null
  sessionKind?: SessionKind | null
}): SessionKind {
  if (row.sessionKind === 'timer' || row.sessionKind === 'file' || row.sessionKind === 'workspace') {
    return row.sessionKind
  }
  if (row.fileId) return 'file'
  return 'workspace'
}

/** Main sidebar / phone session list / bootstrap pick. */
export function isWorkspaceSession(row: {
  fileId?: string | null
  sessionKind?: SessionKind | null
}): boolean {
  return sessionKindOf(row) === 'workspace'
}

/** Schedule editor — not a fired run conversation. */
export function isTimerDefinition(row: {
  sessionKind?: SessionKind | null
  timerRunId?: string | null
}): boolean {
  return row.sessionKind === 'timer' && !row.timerRunId
}
