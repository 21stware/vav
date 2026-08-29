/**
 * Combined workspace host: identity + the services that must run next to
 * the files (fs, process spawn).
 *
 * Desktop VAV's UI talks to the local host today. A later remote host is
 * another implementation of the same interface; HostRegistry is the lookup.
 *
 * Not yet behind this interface (next slices): git, DuckDB / retrieval.
 */

import { hostname, userInfo } from 'node:os'
import {
  LOCAL_MACHINE_ID,
  normalizeMachineId,
  type WorkspaceHostInfo,
  type WorkspaceHostKind
} from '../../shared/workspaceHost.ts'
import { localHostFs, type HostFs } from './HostFs.ts'
import { localHostProcess, type HostProcess } from './HostProcess.ts'
import { localHostPty, type HostPty } from './HostPty.ts'

export interface WorkspaceHost {
  readonly id: string
  readonly info: WorkspaceHostInfo
  readonly fs: HostFs
  readonly process: HostProcess
  readonly pty: HostPty
}

export type HostRegistryListener = (hosts: WorkspaceHostInfo[]) => void

function localHostName(): string {
  try {
    const host = hostname().trim()
    if (host) return host
  } catch {
    /* ignore */
  }
  try {
    const user = userInfo().username?.trim()
    if (user) return `${user}'s machine`
  } catch {
    /* ignore */
  }
  return 'This machine'
}

export function createLocalWorkspaceHost(opts?: {
  name?: string
  fs?: HostFs
  process?: HostProcess
  pty?: HostPty
}): WorkspaceHost {
  const id = LOCAL_MACHINE_ID
  const name = opts?.name?.trim() || localHostName()
  return {
    id,
    info: {
      id,
      name,
      kind: 'local',
      online: true,
      platform: process.platform
    },
    fs: opts?.fs ?? localHostFs,
    process: opts?.process ?? localHostProcess,
    pty: opts?.pty ?? localHostPty
  }
}

export class HostRegistry {
  private readonly hosts = new Map<string, WorkspaceHost>()
  private readonly listeners = new Set<HostRegistryListener>()

  constructor(local: WorkspaceHost = createLocalWorkspaceHost()) {
    this.hosts.set(local.id, local)
  }

  local(): WorkspaceHost {
    const host = this.hosts.get(LOCAL_MACHINE_ID)
    if (!host) throw new Error('Local workspace host is missing')
    return host
  }

  get(machineId: string): WorkspaceHost | undefined {
    return this.hosts.get(machineId)
  }

  /**
   * Resolve a conversation's machine. Unknown / missing ids fall back to
   * the local host so a stale remote session still opens instead of throwing.
   */
  hostFor(machineId: string | null | undefined): WorkspaceHost {
    return this.get(normalizeMachineId(machineId)) ?? this.local()
  }

  require(machineId: string): WorkspaceHost {
    const host = this.get(machineId)
    if (!host) throw new Error(`Unknown workspace host: ${machineId}`)
    return host
  }

  register(host: WorkspaceHost): void {
    this.hosts.set(host.id, host)
    this.emit()
  }

  remove(machineId: string): boolean {
    if (machineId === LOCAL_MACHINE_ID) return false
    const gone = this.hosts.delete(machineId)
    if (gone) this.emit()
    return gone
  }

  list(): WorkspaceHostInfo[] {
    return [...this.hosts.values()].map((host) => host.info)
  }

  onChange(listener: HostRegistryListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    const snapshot = this.list()
    for (const listener of this.listeners) listener(snapshot)
  }
}

export function hostKindOf(host: WorkspaceHost): WorkspaceHostKind {
  return host.info.kind
}
