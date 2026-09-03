/**
 * Pseudo-terminal on a workspace host.
 *
 * User PTY tabs (node-pty) go through this so a later remote daemon can
 * stream the same bytes. Preview / Quick Look stay on the UI machine.
 */

import * as pty from 'node-pty'
import type { IPty } from 'node-pty'

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

type ConptyAgent = {
  _conoutSocketWorker?: { dispose?: () => void }
  _inSocket?: { destroy?: () => void; unref?: () => void }
  _outSocket?: { destroy?: () => void; unref?: () => void }
  _closeTimeout?: NodeJS.Timeout
}

type WindowsPty = IPty & {
  _isReady?: boolean
  _agent?: ConptyAgent
}

/**
 * node-pty's Windows ConPTY path keeps a `worker_threads` Worker and named-pipe
 * sockets alive until `kill()` runs. Natural process exit only flushes the
 * out-socket after 1s — it never terminates the worker — so a Node test
 * worker (and a quitting app) can hang forever. `kill()` is also deferred
 * until the first data event (`_isReady`); force that flag so teardown still
 * runs when the child exits before it prints.
 */
function disposeLocalPty(proc: IPty, signal?: string): void {
  const win = proc as WindowsPty
  if (win._isReady === false) win._isReady = true
  try {
    if (signal) proc.kill(signal)
    else proc.kill()
  } catch {
    try {
      proc.kill()
    } catch {
      /* already dead, or Windows rejected a signal */
    }
  }
  const agent = win._agent
  if (!agent) return
  if (agent._closeTimeout) clearTimeout(agent._closeTimeout)
  try {
    agent._conoutSocketWorker?.dispose?.()
  } catch {
    /* ignore */
  }
  try {
    agent._inSocket?.destroy?.()
    agent._inSocket?.unref?.()
  } catch {
    /* ignore */
  }
  try {
    agent._outSocket?.destroy?.()
    agent._outSocket?.unref?.()
  } catch {
    /* ignore */
  }
}

export function createLocalHostPty(): HostPty {
  return {
    spawn(file, args, opts) {
      const proc = pty.spawn(file, args, {
        name: opts.name ?? 'xterm-256color',
        cols: opts.cols,
        rows: opts.rows,
        cwd: opts.cwd,
        env: opts.env,
        useConpty: opts.useConpty
      })
      let disposed = false
      const tearDown = (signal?: string): void => {
        if (disposed) return
        disposed = true
        disposeLocalPty(proc, signal)
      }
      proc.onExit(() => tearDown())
      return {
        get pid() {
          return proc.pid
        },
        onData(listener) {
          proc.onData(listener)
        },
        onExit(listener) {
          proc.onExit(listener)
        },
        write(data) {
          proc.write(data)
        },
        resize(cols, rows) {
          proc.resize(cols, rows)
        },
        kill(signal) {
          tearDown(signal)
        }
      }
    }
  }
}

export const localHostPty = createLocalHostPty()
