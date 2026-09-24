/**
 * Composer id used on the workbench home before the first send mints a
 * conversation. The agent column never shares this key — New Session mints
 * its own conversation so drafts, workspace, usage, and CLI stay separate.
 */
export const PENDING_COMPOSER_ID = '__pending__'

export type PendingHomeWorkspace = {
  path: string | null
  machineId?: string | null
}

/** Workbench home composer only — not an empty agent session. */
export function isHomeComposerId(id: string | null | undefined): boolean {
  return id === PENDING_COMPOSER_ID
}

/** No minted conversation yet — first send should create one. */
export function isPendingComposerId(id: string | null | undefined): boolean {
  return !id?.trim() || id === PENDING_COMPOSER_ID
}

/** Draft / workspace key. Empty agent ids stay empty; do not alias onto home. */
export function resolveComposerId(id: string | null | undefined): string {
  return id?.trim() ?? ''
}

/** Workspace shown on home before a conversation exists. */
export function resolvePendingWorkspace(
  pending: PendingHomeWorkspace | null,
  defaultWorkdir: string
): PendingHomeWorkspace {
  if (pending) return pending
  return { path: defaultWorkdir.trim() || null }
}

/** Create-conversation opts from an explicit home workspace pick. */
export function homeWorkspaceCreateOptions(pending: PendingHomeWorkspace | null): {
  workingDirectory?: string | null
  machineId?: string | null
} {
  if (!pending) return {}
  return {
    workingDirectory: pending.path,
    ...(pending.machineId ? { machineId: pending.machineId } : {})
  }
}
