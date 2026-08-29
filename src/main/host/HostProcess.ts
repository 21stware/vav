/**
 * Child-process spawn on a workspace host.
 *
 * CLI agent stdio (ACP / Claude / Codex / …) and ACP `terminal/*` callbacks
 * go through this so the same spawn can later run on a remote daemon.
 */

import { spawn } from 'node:child_process'

export type HostSpawnStdio = 'pipe' | 'ignore' | 'inherit'

export type HostSpawnOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  argv0?: string
  stdio?: [HostSpawnStdio, HostSpawnStdio, HostSpawnStdio]
  detached?: boolean
  windowsHide?: boolean
}

export interface HostChild {
  readonly pid?: number
  readonly killed: boolean
  readonly stdin: NodeJS.WritableStream | null
  readonly stdout: NodeJS.ReadableStream | null
  readonly stderr: NodeJS.ReadableStream | null
  kill(signal?: NodeJS.Signals): boolean
  unref(): void
  on(event: 'error', listener: (err: Error) => void): this
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  off(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
}

/** Stdio spawn with all three streams piped — CLI agent transports. */
export interface HostStdioChild extends HostChild {
  stdin: NodeJS.WritableStream
  stdout: NodeJS.ReadableStream
  stderr: NodeJS.ReadableStream
}

export interface HostProcess {
  spawn(file: string, args: string[], opts?: HostSpawnOptions): HostChild
}

export function createLocalHostProcess(): HostProcess {
  return {
    spawn(file, args, opts) {
      return spawn(file, args, {
        cwd: opts?.cwd,
        env: opts?.env,
        argv0: opts?.argv0,
        stdio: opts?.stdio ?? ['pipe', 'pipe', 'pipe'],
        detached: opts?.detached,
        windowsHide: opts?.windowsHide
      }) as HostChild
    }
  }
}

export const localHostProcess = createLocalHostProcess()

export function asHostStdioChild(child: HostChild): HostStdioChild {
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error('host process is missing piped stdio')
  }
  return child as HostStdioChild
}
