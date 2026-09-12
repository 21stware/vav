/**
 * Spawn `cua-driver serve --embedded` as a direct child of VAV.app.
 * Do not launch via `open` / NSWorkspace — that breaks macOS TCC inheritance.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  parseCuaConnection,
  VAV_BUNDLE_ID,
  type CuaConnectionFile
} from '../../shared/computerUse.ts'
import { bundledCuaDriverPath } from './resolveCuaBin.ts'

export type EmbeddedCuaStatus = {
  running: boolean
  generation: number
  error: string | null
  connection: CuaConnectionFile | null
  binaryPresent: boolean
}

export type EmbeddedCuaOptions = {
  userDataDir: string
  socketPath?: string
  binPath?: () => string | null
}

function defaultSocketPath(userDataDir: string): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\vav-cua-${process.pid}`
  return join(userDataDir, 'cua-driver.sock')
}

export function cuaConnectionPath(userDataDir: string): string {
  return join(userDataDir, 'cua-connection.json')
}

export function readCuaConnectionFile(path: string): CuaConnectionFile | null {
  try {
    return parseCuaConnection(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

export function writeCuaConnectionFile(path: string, connection: CuaConnectionFile): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(connection, null, 2)}\n`)
}

export function clearCuaConnectionFile(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    /* missing is fine */
  }
}

async function waitForDaemon(
  bin: string,
  socket: string,
  spawnImpl: typeof spawn,
  timeoutMs = 12_000
): Promise<void> {
  const started = Date.now()
  let last = 'not ready'
  while (Date.now() - started < timeoutMs) {
    const probe = await new Promise<string>((resolve) => {
      const child = spawnImpl(bin, ['status', '--socket', socket], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      const timer = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {
          /* ignore */
        }
        resolve('status timeout')
      }, 2_000)
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        out += chunk
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        out += chunk
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        resolve(err.message)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve(code === 0 ? 'ok' : out.trim() || `status ${code}`)
      })
    })
    if (probe === 'ok') return
    last = probe
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`cua-driver daemon did not come up: ${last}`)
}

export function createEmbeddedCua(opts: EmbeddedCuaOptions): {
  start: () => Promise<CuaConnectionFile>
  stop: () => void
  status: () => EmbeddedCuaStatus
  connectionPath: string
} {
  const connectionPath = cuaConnectionPath(opts.userDataDir)
  const socketPath = opts.socketPath ?? defaultSocketPath(opts.userDataDir)
  let child: ChildProcess | null = null
  let generation = 0
  let error: string | null = null
  let connection: CuaConnectionFile | null = readCuaConnectionFile(connectionPath)

  const resolveBin = (): string => {
    const bin = opts.binPath?.() ?? bundledCuaDriverPath()
    if (!bin) throw new Error('Bundled cua-driver is missing. Run npm run fetch:cua-driver.')
    return bin
  }

  const stop = (): void => {
    if (child) {
      try {
        child.kill('SIGTERM')
      } catch {
        /* already gone */
      }
      child = null
    }
    if (process.platform !== 'win32' && existsSync(socketPath)) {
      try {
        unlinkSync(socketPath)
      } catch {
        /* ignore */
      }
    }
    clearCuaConnectionFile(connectionPath)
    connection = null
  }

  return {
    connectionPath,
    status: () => ({
      running: Boolean(child && child.exitCode == null),
      generation,
      error,
      connection,
      binaryPresent: Boolean(opts.binPath?.() ?? bundledCuaDriverPath())
    }),
    stop,
    start: async () => {
      stop()
      const bin = resolveBin()
      generation += 1
      error = null
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        CUA_DRIVER_EMBEDDED: '1',
        CUA_DRIVER_HOST_BUNDLE_ID: VAV_BUNDLE_ID,
        CUA_DRIVER_PERMISSION_MODE: 'standard'
      }
      const spawned = spawn(
        bin,
        [
          'serve',
          '--embedded',
          '--socket',
          socketPath,
          '--permission-mode',
          'standard',
          '--no-permissions-gate',
          '--host-bundle-id',
          VAV_BUNDLE_ID
        ],
        { env, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      child = spawned
      spawned.on('exit', (code) => {
        if (child === spawned) {
          child = null
          if (code && code !== 0) error = `cua-driver exited ${code}`
          clearCuaConnectionFile(connectionPath)
          connection = null
        }
      })
      try {
        await waitForDaemon(bin, socketPath, spawn)
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        stop()
        throw err
      }
      const next: CuaConnectionFile = {
        socketPath,
        binPath: bin,
        generation,
        startedAt: new Date().toISOString()
      }
      writeCuaConnectionFile(connectionPath, next)
      connection = next
      process.env.VAV_CUA_CONNECTION = connectionPath
      return next
    }
  }
}
