/**
 * Workspace host identity — the machine a session's workdir, agent, and
 * shell actually run on.
 *
 * Paths alone are not enough once a desktop VAV can attach to another
 * machine's daemon. A workspace is `{ machineId, path }`; `local` is this
 * process (the built-in daemon the UI already talks to).
 *
 * This module is pure (no Node imports) so the renderer and a future
 * headless `vavd` can share the same types.
 */

/** This process. Remote hosts use a paired machine id. */
export const LOCAL_MACHINE_ID = 'local'

export type WorkspaceHostKind = 'local' | 'remote'

/** Snapshot shown in machine lists and session chrome. */
export type WorkspaceHostInfo = {
  id: string
  /** Human label (`This Mac`, `build-server`). */
  name: string
  kind: WorkspaceHostKind
  online: boolean
  /** `darwin` / `linux` / `win32` when known. */
  platform?: string
}

/** A directory on a specific host. */
export type WorkspaceRef = {
  machineId: string
  path: string
}

export function normalizeMachineId(machineId: string | null | undefined): string {
  const id = machineId?.trim()
  return id || LOCAL_MACHINE_ID
}

export function isLocalMachine(machineId: string | null | undefined): boolean {
  return normalizeMachineId(machineId) === LOCAL_MACHINE_ID
}

/**
 * `~/repo/foo` on this machine; `build-server : ~/repo/foo` elsewhere.
 * `hostName` is the human label when the registry knows it; otherwise the id.
 */
export function formatWorkspaceLabel(
  machineId: string | null | undefined,
  pathLabel: string,
  hostName?: string | null
): string {
  const id = normalizeMachineId(machineId)
  if (id === LOCAL_MACHINE_ID) return pathLabel
  const label = hostName?.trim() || id
  return `${label} : ${pathLabel}`
}

export function workspaceRef(
  path: string,
  machineId?: string | null
): WorkspaceRef {
  return { machineId: normalizeMachineId(machineId), path }
}
