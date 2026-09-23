/**
 * Composer id used on the workbench home (and empty agent shell) before the
 * first send mints a conversation.
 */
export const PENDING_COMPOSER_ID = '__pending__'

export type PendingHomeWorkspace = {
  path: string | null
  machineId?: string | null
}

export function isPendingComposerId(id: string | null | undefined): boolean {
  return id === PENDING_COMPOSER_ID
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
