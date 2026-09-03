/**
 * TEMP DIR → folder: move the minted temp container's contents into the
 * destination so it contains `Workspace` (mintTempWorkdir layout:
 * `$TMPDIR/vav/<8 hex>/Workspace`).
 */

import { isEphemeralWorkspaceKey } from './accounts.ts'
import { hostJoin } from './workspaceHost.ts'

export const TEMP_WORKSPACE_FOLDER = 'Workspace'

/** Parent of `…/vav/<8 hex>/Workspace` — the TEMP DIR container. */
export function tempDirContainer(workdir: string): string | null {
  if (!isEphemeralWorkspaceKey(workdir)) return null
  return hostDirnamePath(workdir)
}

export function hostDirnamePath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (index <= 0) return trimmed.startsWith('/') ? '/' : trimmed
  if (/^[A-Za-z]:$/.test(trimmed.slice(0, index))) return trimmed.slice(0, index + 1)
  return trimmed.slice(0, index)
}

export function hostBasenamePath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index >= 0 ? trimmed.slice(index + 1) : trimmed
}

export type LocateTempDirPlan =
  | {
      ok: true
      container: string
      nextWorkdir: string
      moves: { from: string; to: string }[]
      cleanup: string[]
    }
  | { ok: false; reason: 'not-temp' }

/**
 * Plan moving every child of the temp container into `destinationDir`.
 * Typical result: `{destinationDir}/Workspace` plus leftover empty dirs to drop.
 */
export function planLocateTempDir(
  workdir: string,
  destinationDir: string,
  containerEntries: readonly string[],
  platform?: string
): LocateTempDirPlan {
  const container = tempDirContainer(workdir)
  if (!container) return { ok: false, reason: 'not-temp' }
  const names = containerEntries.filter((name) => name && name !== '.' && name !== '..')
  const dest = destinationDir.replace(/[\\/]+$/, '') || destinationDir
  const workspaceName = hostBasenamePath(workdir) || TEMP_WORKSPACE_FOLDER
  const moves = names.map((name) => ({
    from: hostJoin(platform, container, name),
    to: hostJoin(platform, dest, name)
  }))
  return {
    ok: true,
    container,
    nextWorkdir: hostJoin(platform, dest, workspaceName),
    moves,
    cleanup: [container, hostDirnamePath(container)]
  }
}
