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
  /** Home directory on that machine, when the daemon has said. */
  home?: string
  /** Temp directory on that machine (`welcome.tmp`). */
  tmp?: string
  /** Last non-temp folder opened on this host. */
  defaultPath?: string
  /** CLI binaries discovered on this host (remote daemons). */
  providers?: HostProviderInfo[]
}

/** A directory on a specific host. */
export type WorkspaceRef = {
  machineId: string
  path: string
}

/** CLI agent discovered on a workspace-host daemon. */
export type HostProviderInfo = {
  id: string
  name: string
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

export function workspaceRefKey(ref: WorkspaceRef): string {
  return `${normalizeMachineId(ref.machineId)}\n${ref.path}`
}

export function sameWorkspaceRef(a: WorkspaceRef, b: WorkspaceRef): boolean {
  return workspaceRefKey(a) === workspaceRefKey(b)
}

export function parseWorkspaceRef(value: unknown): WorkspaceRef | null {
  if (typeof value === 'string') {
    const path = value.trim()
    return path ? workspaceRef(path) : null
  }
  if (typeof value !== 'object' || value === null) return null
  const rec = value as { machineId?: unknown; path?: unknown }
  const path = typeof rec.path === 'string' ? rec.path.trim() : ''
  if (!path) return null
  return workspaceRef(path, typeof rec.machineId === 'string' ? rec.machineId : undefined)
}

export function parseWorkspaceRefList(raw: unknown): WorkspaceRef[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: WorkspaceRef[] = []
  for (const entry of raw) {
    const ref = parseWorkspaceRef(entry)
    if (!ref) continue
    const key = workspaceRefKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}

export function recentsForMachine(
  list: readonly WorkspaceRef[] | undefined,
  machineId: string | null | undefined
): WorkspaceRef[] {
  const id = normalizeMachineId(machineId)
  return (list ?? []).filter((ref) => normalizeMachineId(ref.machineId) === id)
}

export function serializeWorkspaceRefList(list: readonly WorkspaceRef[]): string {
  return list.map(workspaceRefKey).join('\0')
}

/** Join path parts with the host's separator. Pure — no `node:path`. */
export function hostJoin(platform: string | undefined, ...parts: string[]): string {
  const win = platform === 'win32'
  const sep = win ? '\\' : '/'
  let acc = ''
  for (const part of parts) {
    if (!part) continue
    const piece = win ? part.replace(/\//g, '\\') : part.replace(/\\/g, '/')
    if (!acc) {
      acc = piece
      continue
    }
    acc = `${acc.replace(/[\\/]+$/, '')}${sep}${piece.replace(/^[\\/]+/, '')}`
  }
  if (!acc) return win ? '\\' : '/'
  return acc
}

/** True when a conversation’s workdir / agent run on this machine. */
export function conversationOnMachine(
  conversation: { machineId?: string | null },
  machineId: string | null | undefined
): boolean {
  return normalizeMachineId(conversation.machineId) === normalizeMachineId(machineId)
}
