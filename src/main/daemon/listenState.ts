/**
 * Persist the control-plane listen address so `vavc` / `vavcli` can find a
 * running vavd from its state dir (including ephemeral `--port 0`).
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import { writePrivateJson } from './identity.ts'

export const LISTEN_FILE = 'listen.json'

export type VavdListenState = {
  host: string
  port: number
  pid?: number
  startedAt?: number
}

export function listenFile(stateDir: string): string {
  return join(stateDir, LISTEN_FILE)
}

export function writeListenState(stateDir: string, state: VavdListenState): void {
  writePrivateJson(listenFile(stateDir), {
    host: state.host,
    port: state.port,
    pid: state.pid ?? process.pid,
    startedAt: state.startedAt ?? Date.now()
  })
}

export function readListenState(stateDir: string): VavdListenState | null {
  try {
    const raw = JSON.parse(readFileSync(listenFile(stateDir), 'utf8')) as {
      host?: unknown
      port?: unknown
      pid?: unknown
      startedAt?: unknown
    }
    if (typeof raw.host !== 'string' || !raw.host.trim()) return null
    if (typeof raw.port !== 'number' || !Number.isInteger(raw.port) || raw.port <= 0) return null
    return {
      host: raw.host.trim(),
      port: raw.port,
      pid: typeof raw.pid === 'number' ? raw.pid : undefined,
      startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : undefined
    }
  } catch {
    return null
  }
}

export function clearListenState(stateDir: string): void {
  try {
    rmSync(listenFile(stateDir), { force: true })
  } catch {
    /* ignore */
  }
}

export function listenStateExists(stateDir: string): boolean {
  return existsSync(listenFile(stateDir))
}

/** True when something accepts a TCP connection on the recorded listen address. */
export function probeListenAlive(
  state: Pick<VavdListenState, 'host' | 'port'>,
  timeoutMs = 400
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: state.host, port: state.port })
    const done = (ok: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      done(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      done(false)
    })
  })
}
