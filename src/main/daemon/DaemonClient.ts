/**
 * Client for the daemon protocol. Implements HostFs / HostProcess / HostPty
 * over a JSON-line TCP connection so HostRegistry can treat a remote machine
 * like the local one.
 */

import { EventEmitter } from 'node:events'
import { createConnection, type Socket } from 'node:net'
import { PassThrough } from 'node:stream'
import { randomUUID } from 'node:crypto'
import {
  DAEMON_PROTO_VERSION,
  parseDaemonServerFrame,
  type DaemonWelcome,
  type FsDirentWire,
  type FsStatWire
} from '../../shared/daemonProtocol.ts'
import type {
  HostChild,
  HostDirent,
  HostFileHandle,
  HostFs,
  HostProcess,
  HostPty,
  HostPtyProcess,
  HostSpawnOptions,
  HostStat,
  HostWatchListener,
  HostWatcher
} from '../host/index.ts'
import type { WorkspaceHost } from '../host/WorkspaceHost.ts'
import type { WorkspaceHostInfo } from '../../shared/workspaceHost.ts'
import { attachLineReader, writeLine } from './jsonLines.ts'

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

type StreamHandler = (event: string, data: unknown) => void

const REQ_TIMEOUT_MS = 30_000
const CONNECT_TIMEOUT_MS = 4_000
const PAIR_ASK_TIMEOUT_MS = 90_000

export const PAIRING_CANCELLED = 'pairing cancelled'

/**
 * Ask a LAN peer to confirm pairing. On allow they send their `vav-daemon://` URI.
 * Does not leave a live session — caller then `pair()`s with that line.
 */
export function requestLanPairOffer(opts: {
  host: string
  port: number
  name: string
  machineId: string
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new Error(PAIRING_CANCELLED))
      return
    }
    const socket = createConnection({ host: opts.host, port: opts.port })
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      reject(err)
      socket.destroy()
    }
    const onAbort = (): void => fail(new Error(PAIRING_CANCELLED))
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      fail(new Error('pairing confirm timed out'))
    }, opts.timeoutMs ?? PAIR_ASK_TIMEOUT_MS)
    socket.on('error', (err) => fail(err))
    socket.on('connect', () => {
      writeLine(socket, {
        type: 'pair-ask',
        proto: DAEMON_PROTO_VERSION,
        name: opts.name,
        machineId: opts.machineId
      })
    })
    socket.on('close', () => {
      if (!settled) fail(new Error('daemon connection closed'))
    })
    attachLineReader(socket, (value) => {
      if (value === null) {
        fail(new Error('invalid json'))
        return
      }
      const frame = parseDaemonServerFrame(value)
      if (!frame) return
      if (frame.type === 'error') {
        fail(new Error(frame.message))
        return
      }
      if (frame.type === 'pair-offer') {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        socket.destroy()
        resolve(frame.pairing)
      }
    })
  })
}

export class DaemonClient {
  private socket: Socket | null = null
  private readonly pending = new Map<string, Pending>()
  private readonly streams = new Map<string, StreamHandler>()
  private readonly streamBacklog = new Map<string, Array<{ event: string; data: unknown }>>()
  private closed = false
  welcome: DaemonWelcome | null = null

  connect(opts: {
    host: string
    port: number
    secret: string
    device?: string
    timeoutMs?: number
    signal?: AbortSignal
  }): Promise<DaemonWelcome> {
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(new Error(PAIRING_CANCELLED))
        return
      }
      const socket = createConnection({ host: opts.host, port: opts.port })
      this.socket = socket
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        reject(err)
      }
      const onAbort = (): void => {
        fail(new Error(PAIRING_CANCELLED))
        socket.destroy()
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => {
        const err = new Error(`connect ETIMEDOUT ${opts.host}:${opts.port}`)
        ;(err as NodeJS.ErrnoException).code = 'ETIMEDOUT'
        fail(err)
        socket.destroy()
      }, opts.timeoutMs ?? CONNECT_TIMEOUT_MS)
      socket.on('error', (err) => fail(err))
      socket.on('connect', () => {
        writeLine(socket, {
          type: 'hello',
          proto: DAEMON_PROTO_VERSION,
          auth: opts.secret,
          role: 'daemon',
          device: opts.device
        })
      })
      socket.on('close', () => {
        this.closed = true
        const err = new Error('daemon connection closed')
        for (const wait of this.pending.values()) wait.reject(err)
        this.pending.clear()
        if (!settled) fail(err)
      })
      attachLineReader(socket, (value) => {
        if (value === null) {
          socket.destroy()
          return
        }
        const frame = parseDaemonServerFrame(value)
        if (!frame) return
        if (!settled && frame.type === 'error') {
          fail(new Error(frame.message))
          socket.destroy()
          return
        }
        if (!settled && frame.type === 'welcome') {
          settled = true
          if (timer) clearTimeout(timer)
          opts.signal?.removeEventListener('abort', onAbort)
          this.welcome = frame
          resolve(frame)
          return
        }
        if (frame.type === 'res') {
          const wait = this.pending.get(frame.id)
          if (!wait) return
          this.pending.delete(frame.id)
          if (frame.ok) wait.resolve(frame.result)
          else wait.reject(new Error(frame.error?.message ?? 'daemon request failed'))
          return
        }
        if (frame.type === 'stream') {
          const handler = this.streams.get(frame.stream)
          if (handler) handler(frame.event, frame.data)
          else {
            const queued = this.streamBacklog.get(frame.stream) ?? []
            queued.push({ event: frame.event, data: frame.data })
            this.streamBacklog.set(frame.stream, queued)
          }
        }
      })
    })
  }

  async request(method: string, params?: unknown, timeoutMs = REQ_TIMEOUT_MS): Promise<unknown> {
    if (this.closed || !this.socket) throw new Error('daemon is not connected')
    const id = randomUUID()
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`daemon ${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        }
      })
    })
    writeLine(this.socket, { type: 'req', id, method, params })
    return result
  }

  onStream(id: string, handler: StreamHandler): void {
    this.streams.set(id, handler)
    const queued = this.streamBacklog.get(id)
    if (queued) {
      this.streamBacklog.delete(id)
      for (const item of queued) handler(item.event, item.data)
    }
  }

  offStream(id: string): void {
    this.streams.delete(id)
    this.streamBacklog.delete(id)
  }

  close(): void {
    this.closed = true
    this.socket?.destroy()
    this.socket = null
  }

  get connected(): boolean {
    return Boolean(this.socket && !this.closed && !this.socket.destroyed)
  }

  async which(candidates: string[]): Promise<string | null> {
    const names = candidates.map((c) => c.trim()).filter(Boolean)
    if (names.length === 0) return null
    const result = (await this.request('proc.which', { candidates: names })) as {
      path?: string | null
    }
    const path = typeof result.path === 'string' ? result.path.trim() : ''
    return path || null
  }
}

function statFromWire(wire: FsStatWire): HostStat {
  return {
    size: wire.size,
    mtimeMs: wire.mtimeMs,
    birthtimeMs: wire.birthtimeMs,
    ctimeMs: wire.ctimeMs,
    mode: wire.mode,
    uid: wire.uid,
    gid: wire.gid,
    ino: wire.ino,
    isDirectory: () => wire.isDirectory,
    isFile: () => wire.isFile
  }
}

export function createRemoteHostFs(client: DaemonClient): HostFs {
  return {
    async readdir(path) {
      const result = (await client.request('fs.readdir', { path })) as { entries: FsDirentWire[] }
      return (result.entries ?? []).map(
        (d): HostDirent => ({
          name: d.name,
          isDirectory: () => d.isDirectory,
          isFile: () => d.isFile
        })
      )
    },
    async stat(path) {
      const wire = (await client.request('fs.stat', { path })) as FsStatWire
      return statFromWire(wire)
    },
    async readFile(path) {
      const result = (await client.request('fs.readFile', { path }, 120_000)) as { base64: string }
      return Buffer.from(result.base64, 'base64')
    },
    async writeFile(path, data, encoding) {
      if (typeof data === 'string') {
        await client.request('fs.writeFile', { path, text: data, encoding: encoding ?? 'utf8' })
      } else {
        await client.request('fs.writeFile', { path, base64: Buffer.from(data).toString('base64') })
      }
    },
    async mkdir(path, opts) {
      await client.request('fs.mkdir', { path, recursive: opts?.recursive === true })
    },
    async rename(from, to) {
      await client.request('fs.rename', { from, to })
    },
    async open(path, flags) {
      const opened = (await client.request('fs.open', { path, flags })) as { handle: string }
      const handle: HostFileHandle = {
        async read(buffer, offset, length, position) {
          const result = (await client.request('fs.read', {
            handle: opened.handle,
            length,
            position
          })) as { base64: string; bytesRead: number }
          const chunk = Buffer.from(result.base64, 'base64')
          chunk.copy(buffer, offset, 0, Math.min(chunk.length, length))
          return { bytesRead: result.bytesRead }
        },
        async close() {
          await client.request('fs.close', { handle: opened.handle })
        }
      }
      return handle
    },
    watch(path, opts, listener: HostWatchListener) {
      let streamId: string | null = null
      let closed = false
      const errorListeners: Array<(err: Error) => void> = []
      void client
        .request('fs.watch', { path, recursive: opts.recursive === true })
        .then((result) => {
          const stream = (result as { stream: string }).stream
          if (closed) {
            void client.request('fs.unwatch', { stream })
            return
          }
          streamId = stream
          client.onStream(stream, (event, data) => {
            if (event === 'watch') {
              const payload = data as { event?: string; filename?: string | null }
              listener(payload.event ?? 'change', payload.filename ?? null)
            } else if (event === 'error') {
              const err = new Error(String((data as { message?: string })?.message ?? 'watch'))
              for (const cb of errorListeners) cb(err)
            }
          })
        })
        .catch((err) => {
          for (const cb of errorListeners) cb(err instanceof Error ? err : new Error(String(err)))
        })
      const watcher: HostWatcher = {
        on(event, cb) {
          if (event === 'error') errorListeners.push(cb)
        },
        close() {
          closed = true
          if (streamId) {
            client.offStream(streamId)
            void client.request('fs.unwatch', { stream: streamId }).catch(() => undefined)
          }
        }
      }
      return watcher
    },
    async exists(path) {
      const result = (await client.request('fs.exists', { path })) as { exists: boolean }
      return result.exists === true
    },
    async unlink(path) {
      await client.request('fs.unlink', { path })
    }
  }
}

/**
 * Spawn is async on the wire but HostProcess.spawn is sync. Issue the RPC
 * immediately and return a child that binds streams when the id arrives.
 */
export function createRemoteHostProcess(client: DaemonClient): HostProcess {
  return {
    spawn(file, args, opts?: HostSpawnOptions) {
      const env: Record<string, string> = {}
      if (opts?.env) {
        for (const [key, value] of Object.entries(opts.env)) {
          if (typeof value === 'string') env[key] = value
        }
      }
      const stdin = new PassThrough()
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      const emitter = new EventEmitter()
      let streamId: string | null = null
      let boundPid: number | undefined
      let killed = false
      let stdinEnded = false
      const stdinQueue: Buffer[] = []
      const flushStdin = (buf: Buffer): void => {
        void client.request('process.write', { stream: streamId, base64: buf.toString('base64') }).catch(
          () => undefined
        )
      }
      stdin.on('data', (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        if (!streamId) {
          stdinQueue.push(buf)
          return
        }
        flushStdin(buf)
      })
      stdin.on('end', () => {
        stdinEnded = true
        if (streamId) void client.request('process.end', { stream: streamId }).catch(() => undefined)
      })
      const child = Object.assign(emitter, {
        get pid() {
          return boundPid
        },
        get killed() {
          return killed
        },
        stdin,
        stdout,
        stderr,
        kill(signal?: NodeJS.Signals) {
          killed = true
          if (streamId) {
            void client.request('process.kill', { stream: streamId, signal }).catch(() => undefined)
          }
          return true
        },
        unref() {
          if (streamId) void client.request('process.unref', { stream: streamId }).catch(() => undefined)
        }
      }) as unknown as HostChild
      void client
        .request('process.spawn', {
          file,
          args,
          opts: {
            cwd: opts?.cwd,
            env,
            argv0: opts?.argv0,
            stdio: opts?.stdio,
            detached: opts?.detached,
            windowsHide: opts?.windowsHide
          }
        })
        .then((result) => {
          const spawned = result as { stream: string; pid?: number }
          streamId = spawned.stream
          boundPid = spawned.pid
          for (const buf of stdinQueue) {
            void client.request('process.write', { stream: streamId, base64: buf.toString('base64') }).catch(
              () => undefined
            )
          }
          stdinQueue.length = 0
          if (stdinEnded) {
            void client.request('process.end', { stream: streamId }).catch(() => undefined)
          }
          client.onStream(spawned.stream, (event, data) => {
            const payload = data as {
              base64?: string
              message?: string
              code?: number | null
              signal?: string | null
            }
            if (event === 'stdout' && payload.base64) stdout.push(Buffer.from(payload.base64, 'base64'))
            else if (event === 'stderr' && payload.base64) stderr.push(Buffer.from(payload.base64, 'base64'))
            else if (event === 'error') emitter.emit('error', new Error(payload.message ?? 'process error'))
            else if (event === 'exit') emitter.emit('exit', payload.code ?? null, payload.signal ?? null)
            else if (event === 'close') {
              stdout.push(null)
              stderr.push(null)
              emitter.emit('close', payload.code ?? null, payload.signal ?? null)
              client.offStream(spawned.stream)
            }
          })
        })
        .catch((err) => {
          emitter.emit('error', err instanceof Error ? err : new Error(String(err)))
          emitter.emit('exit', 1, null)
          emitter.emit('close', 1, null)
        })
      return child
    }
  }
}

export function createRemoteHostPty(client: DaemonClient): HostPty {
  return {
    spawn(file, args, opts) {
      const env = opts.env ?? {}
      let streamId: string | null = null
      let pid = 0
      const dataListeners: Array<(data: string) => void> = []
      const exitListeners: Array<(e: { exitCode: number; signal?: number }) => void> = []
      const writeQueue: string[] = []
      const proc: HostPtyProcess = {
        get pid() {
          return pid
        },
        onData(listener) {
          dataListeners.push(listener)
        },
        onExit(listener) {
          exitListeners.push(listener)
        },
        write(data) {
          if (!streamId) {
            writeQueue.push(data)
            return
          }
          void client.request('pty.write', { stream: streamId, data }).catch(() => undefined)
        },
        resize(cols, rows) {
          if (streamId) void client.request('pty.resize', { stream: streamId, cols, rows }).catch(() => undefined)
        },
        kill(signal) {
          if (streamId) void client.request('pty.kill', { stream: streamId, signal }).catch(() => undefined)
        }
      }
      void client
        .request('pty.spawn', {
          file,
          args,
          opts: {
            name: opts.name,
            cols: opts.cols,
            rows: opts.rows,
            cwd: opts.cwd,
            env,
            useConpty: opts.useConpty
          }
        })
        .then((result) => {
          const spawned = result as { stream: string; pid: number }
          streamId = spawned.stream
          pid = spawned.pid
          for (const data of writeQueue) {
            void client.request('pty.write', { stream: streamId, data }).catch(() => undefined)
          }
          writeQueue.length = 0
          client.onStream(spawned.stream, (event, data) => {
            if (event === 'pty-data') {
              const text = String((data as { text?: string })?.text ?? '')
              for (const cb of dataListeners) cb(text)
            } else if (event === 'pty-exit') {
              const payload = data as { exitCode?: number; signal?: number }
              for (const cb of exitListeners) {
                cb({ exitCode: payload.exitCode ?? 0, signal: payload.signal })
              }
              client.offStream(spawned.stream)
            }
          })
        })
        .catch((err) => {
          for (const cb of exitListeners) cb({ exitCode: 1 })
          void err
        })
      return proc
    }
  }
}

export function createRemoteWorkspaceHost(client: DaemonClient, welcome: DaemonWelcome): WorkspaceHost {
  const info: WorkspaceHostInfo = {
    id: welcome.host.id,
    name: welcome.host.name,
    kind: 'remote',
    online: true,
    platform: welcome.host.platform,
    home: welcome.home,
    tmp: welcome.tmp
  }
  return {
    id: info.id,
    info,
    fs: createRemoteHostFs(client),
    process: createRemoteHostProcess(client),
    pty: createRemoteHostPty(client)
  }
}
