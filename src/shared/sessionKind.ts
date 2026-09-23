/**
 * Session kinds. The list column shows workspace conversations only.
 * file / timer / db / knowledge are app objects (storage, scheduled, data, knowledge).
 * listMeta stays workspace-only for host / account catalogs.
 */
export type SessionKind = 'workspace' | 'file' | 'timer' | 'db' | 'knowledge'

export function sessionKindOf(row: {
  fileId?: string | null
  sessionKind?: SessionKind | null
}): SessionKind {
  if (
    row.sessionKind === 'timer' ||
    row.sessionKind === 'file' ||
    row.sessionKind === 'workspace' ||
    row.sessionKind === 'db' ||
    row.sessionKind === 'knowledge'
  ) {
    return row.sessionKind
  }
  if (row.fileId) return 'file'
  return 'workspace'
}

/** Fired schedule run — an agent conversation, not the schedule editor. */
export function isTimerRun(row: {
  sessionKind?: SessionKind | null
  timerRunId?: string | null
}): boolean {
  return row.sessionKind === 'timer' && !!row.timerRunId
}

/** List-column session rows. App objects are not sessions. */
export function isWorkspaceSession(row: {
  fileId?: string | null
  sessionKind?: SessionKind | null
  timerRunId?: string | null
}): boolean {
  return sessionKindOf(row) === 'workspace' || isTimerRun(row)
}

/** Alias of isWorkspaceSession — the list is only agent conversations. */
export const isListSession = isWorkspaceSession

/** Note, scheduled task, db connection, or storage file — lives in app, not list. */
export function isAppObjectSession(row: {
  fileId?: string | null
  sessionKind?: SessionKind | null
  timerRunId?: string | null
}): boolean {
  return !isWorkspaceSession(row)
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

export function isKnowledgeSession(row: { sessionKind?: SessionKind | null }): boolean {
  return row.sessionKind === 'knowledge'
}
