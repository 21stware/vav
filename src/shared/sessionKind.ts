/**
 * Session kinds. Workspace rows are the main sidebar. File, timer, and db
 * conversations share ConversationStore but stay out of listMeta.
 * Timer / db rows are published via listClientMeta for their category panels.
 */
export type SessionKind = 'workspace' | 'file' | 'timer' | 'db'

export function sessionKindOf(row: {
  fileId?: string | null
  sessionKind?: SessionKind | null
}): SessionKind {
  if (
    row.sessionKind === 'timer' ||
    row.sessionKind === 'file' ||
    row.sessionKind === 'workspace' ||
    row.sessionKind === 'db'
  ) {
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

export function isDbSession(row: { sessionKind?: SessionKind | null }): boolean {
  return row.sessionKind === 'db'
}
