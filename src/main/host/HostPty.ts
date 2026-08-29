/**
 * Pseudo-terminal on a workspace host.
 *
 * User PTY tabs (node-pty) go through this so a later remote daemon can
 * stream the same bytes. Preview / Quick Look stay on the UI machine.
 */

import * as pty from 'node-pty'

export type HostPtyExit = {
  exitCode: number
  signal?: number
}

export type HostPtySpawnOptions = {
  name?: string
  cols: number
  rows: number
  cwd?: string
  env?: Record<string, string>
  useConpty?: boolean
}

export interface HostPtyProcess {
  readonly pid: number
  onData(listener: (data: string) => void): void
  onExit(listener: (e: HostPtyExit) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

export interface HostPty {
  spawn(file: string, args: string[], opts: HostPtySpawnOptions): HostPtyProcess
}

export function createLocalHostPty(): HostPty {
  return {
    spawn(file, args, opts) {
      return pty.spawn(file, args, {
        name: opts.name ?? 'xterm-256color',
        cols: opts.cols,
        rows: opts.rows,
        cwd: opts.cwd,
        env: opts.env,
        useConpty: opts.useConpty
      })
    }
  }
}

export const localHostPty = createLocalHostPty()
