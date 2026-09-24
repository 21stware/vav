/**
 * Composer id used on the workbench home (and empty agent shell) before the
 * first send mints a conversation.
 */
export const PENDING_COMPOSER_ID = '__pending__'

export type PendingHomeWorkspace = {
  path: string | null
  machineId?: string | null
}

/** Home / empty-session shell — no minted conversation yet. */
export function isPendingComposerId(id: string | null | undefined): boolean {
  return !id?.trim() || id === PENDING_COMPOSER_ID
}

/** Stable key for drafts / workspace / model picks on the empty shell. */
export function resolveComposerId(id: string | null | undefined): string {
  return isPendingComposerId(id) ? PENDING_COMPOSER_ID : id
}

/** Workspace shown on home / empty session before a conversation exists. */
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
