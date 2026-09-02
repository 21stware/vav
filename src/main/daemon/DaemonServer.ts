/**
 * Serves a WorkspaceHost over the daemon JSON-line protocol.
 *
 * Used by headless `vavd` and by desktop VAV when other machines attach.
 * Electron-free — only Node + the Host* interfaces.
 */

import { createServer, type Server, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import {
  DAEMON_PROTO_VERSION,
  parseDaemonClientFrame,
  parseDaemonHello,
  parseDaemonPairAsk,
  type DaemonPairAsk,
  type DaemonReq,
  type FsDirentWire,
  type FsStatWire
} from '../../shared/daemonProtocol.ts'
import type { WorkspaceHost } from '../host/WorkspaceHost.ts'
import type { HostChild, HostPtyProcess, HostFileHandle } from '../host/index.ts'
import { attachLineReader, secretsMatch, writeLine } from './jsonLines.ts'
import type { DaemonIdentity } from './identity.ts'
import { whichOnHost } from './procWhich.ts'

type ServerOpts = {
  host: WorkspaceHost
  identity: DaemonIdentity
  secret: () => string
  appVersion: string
  home: string
  tmp: string
  /** This machine's `vav-daemon://` URI — sent after a LAN pair-ask is approved. */
  pairing?: () => string | null
  /** Desktop confirm for LAN Pair. Headless daemons omit this and refuse. */
  onPairAsk?: (from: { name: string; machineId: string }) => Promise<boolean>
}

type LiveProcess = {
  child: HostChild
}

type LivePty = {
  proc: HostPtyProcess
}

type LiveHandle = {
  handle: HostFileHandle
}

type LiveWatch = {
  close: () => void
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export class DaemonServer {
  private readonly opts: ServerOpts
  private server: Server | null = null
  private readonly sockets = new Set<Socket>()
  private listenPort = 0
  private pairAskBusy = false

  constructor(opts: ServerOpts) {
    this.opts = opts
  }

  port(): number {
    return this.listenPort
  }

  listen(port: number, hostname = '0.0.0.0'): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => this.accept(socket))
      server.on('error', reject)
      server.listen(port, hostname, () => {
        server.off('error', reject)
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('daemon listen: no address'))
          return
        }
        this.server = server
        this.listenPort = address.port
        resolve(address.port)
      })
    })
  }

  /** Socket already authenticated (e.g. tailcat multiplex after hello). */
  adopt(socket: Socket, leftover = ''): void {
    this.attachSession(socket, leftover, true)
  }

  close(): void {
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    this.server?.close()
    this.server = null
    this.listenPort = 0
  }

  private accept(socket: Socket): void {
    this.attachSession(socket, '', false)
  }

  private attachSession(socket: Socket, leftover: string, authed: boolean): void {
    this.sockets.add(socket)
    const processes = new Map<string, LiveProcess>()
    const ptys = new Map<string, LivePty>()
    const handles = new Map<string, LiveHandle>()
    const watches = new Map<string, LiveWatch>()
    let ready = authed

    const forget = (): void => {
      this.sockets.delete(socket)
      for (const live of processes.values()) {
        try {
          live.child.kill()
        } catch {
          /* ignore */
        }
      }
      for (const live of ptys.values()) {
        try {
          live.proc.kill()
        } catch {
          /* ignore */
        }
      }
      for (const live of handles.values()) {
        void live.handle.close()
      }
      for (const live of watches.values()) live.close()
      processes.clear()
      ptys.clear()
      handles.clear()
      watches.clear()
    }
    socket.on('close', forget)
    socket.on('error', forget)

    const sendWelcome = (): void => {
      writeLine(socket, {
        type: 'welcome',
        proto: DAEMON_PROTO_VERSION,
        app: 'vavd',
        version: this.opts.appVersion,
        host: {
          id: this.opts.identity.machineId,
          name: this.opts.identity.name,
          kind: 'remote',
          online: true,
          platform: this.opts.host.info.platform
        },
        home: this.opts.home,
        tmp: this.opts.tmp
      })
    }

    if (ready) sendWelcome()

    attachLineReader(socket, (value) => {
      if (value === null) {
        writeLine(socket, { type: 'error', code: 'bad-request', message: 'invalid json' })
        socket.destroy()
        return
      }
      if (!ready) {
        const ask = parseDaemonPairAsk(value)
        if (ask) {
          void this.handlePairAsk(socket, ask)
          return
        }
        const hello = parseDaemonHello(value)
        if (!hello || !secretsMatch(hello.auth, this.opts.secret())) {
          writeLine(socket, { type: 'error', code: 'auth', message: 'pairing rejected' })
          socket.destroy()
          return
        }
        ready = true
        sendWelcome()
        return
      }
      const frame = parseDaemonClientFrame(value)
      if (!frame) {
        writeLine(socket, { type: 'error', code: 'bad-request', message: 'unrecognized frame' })
        return
      }
      if (frame.type === 'hello' || frame.type === 'pair-ask') return
      if (frame.type === 'ping') {
        writeLine(socket, { type: 'pong' })
        return
      }
      void this.dispatch(frame, socket, { processes, ptys, handles, watches })
    }, { leftover })
  }

  private async handlePairAsk(socket: Socket, ask: DaemonPairAsk): Promise<void> {
    if (!this.opts.onPairAsk || !this.opts.pairing) {
      writeLine(socket, { type: 'error', code: 'auth', message: 'pairing requires a pairing line' })
      socket.destroy()
      return
    }
    if (this.pairAskBusy) {
      writeLine(socket, { type: 'error', code: 'auth', message: 'pairing busy' })
      socket.destroy()
      return
    }
    this.pairAskBusy = true
    try {
      const allow = await this.opts.onPairAsk({ name: ask.name, machineId: ask.machineId })
      if (socket.destroyed) return
      if (!allow) {
        writeLine(socket, { type: 'error', code: 'auth', message: 'pairing declined' })
        socket.destroy()
        return
      }
      const pairing = this.opts.pairing()
      if (!pairing) {
        writeLine(socket, { type: 'error', code: 'internal', message: 'not listening' })
        socket.destroy()
        return
      }
      writeLine(socket, { type: 'pair-offer', pairing })
      socket.end()
    } finally {
      this.pairAskBusy = false
    }
  }

  private async dispatch(
    req: DaemonReq,
    socket: Socket,
    live: {
      processes: Map<string, LiveProcess>
      ptys: Map<string, LivePty>
      handles: Map<string, LiveHandle>
      watches: Map<string, LiveWatch>
    }
  ): Promise<void> {
    try {
      const result = await this.runMethod(req.method, req.params, socket, live)
      writeLine(socket, { type: 'res', id: req.id, ok: true, result })
    } catch (err) {
      writeLine(socket, {
        type: 'res',
        id: req.id,
        ok: false,
        error: {
          code: 'internal',
          message: err instanceof Error ? err.message : String(err)
        }
      })
    }
  }

  private async runMethod(
    method: string,
    params: unknown,
    socket: Socket,
    live: {
      processes: Map<string, LiveProcess>
      ptys: Map<string, LivePty>
      handles: Map<string, LiveHandle>
      watches: Map<string, LiveWatch>
    }
  ): Promise<unknown> {
    const p = asRecord(params)
    const fs = this.opts.host.fs
    switch (method) {
      case 'host.info':
        return {
          id: this.opts.identity.machineId,
          name: this.opts.identity.name,
          kind: 'remote',
          online: true,
          platform: this.opts.host.info.platform,
          home: this.opts.home,
          tmp: this.opts.tmp
        }
      case 'fs.readdir': {
        const path = asString(p.path)
        const dirents = await fs.readdir(path)
        const entries: FsDirentWire[] = dirents.map((d) => ({
          name: d.name,
          isDirectory: d.isDirectory(),
          isFile: d.isFile()
        }))
        return { entries }
      }
      case 'fs.stat': {
        const info = await fs.stat(asString(p.path))
        const wire: FsStatWire = {
          size: info.size,
          mtimeMs: info.mtimeMs,
          birthtimeMs: info.birthtimeMs,
          ctimeMs: info.ctimeMs,
          mode: info.mode,
          uid: info.uid,
          gid: info.gid,
          ino: typeof info.ino === 'bigint' ? Number(info.ino) : info.ino,
          isDirectory: info.isDirectory(),
          isFile: info.isFile()
        }
        return wire
      }
      case 'fs.readFile': {
        const buf = await fs.readFile(asString(p.path))
        if (buf.length > 6 * 1024 * 1024) {
          throw new Error('file exceeds daemon read cap (6MB); use fs.open')
        }
        return { base64: buf.toString('base64') }
      }
      case 'fs.writeFile': {
        const path = asString(p.path)
        if (typeof p.text === 'string') {
          await fs.writeFile(path, p.text, (asString(p.encoding, 'utf8') || 'utf8') as BufferEncoding)
        } else {
          await fs.writeFile(path, Buffer.from(asString(p.base64), 'base64'))
        }
        return { ok: true }
      }
      case 'fs.mkdir':
        await fs.mkdir(asString(p.path), { recursive: p.recursive === true })
        return { ok: true }
      case 'fs.rename':
        await fs.rename(asString(p.from), asString(p.to))
        return { ok: true }
      case 'fs.exists':
        return { exists: await fs.exists(asString(p.path)) }
      case 'fs.unlink':
        await fs.unlink(asString(p.path))
        return { ok: true }
      case 'fs.open': {
        const handle = await fs.open(asString(p.path), asString(p.flags, 'r'))
        const id = `h-${randomUUID()}`
        live.handles.set(id, { handle })
        return { handle: id }
      }
      case 'fs.read': {
        const id = asString(p.handle)
        const entry = live.handles.get(id)
        if (!entry) throw new Error('unknown file handle')
        const length = Math.max(1, Math.min(1024 * 1024, Number(p.length) || 4096))
        const position = Math.max(0, Number(p.position) || 0)
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await entry.handle.read(buffer, 0, length, position)
        return { base64: buffer.subarray(0, bytesRead).toString('base64'), bytesRead }
      }
      case 'fs.close': {
        const id = asString(p.handle)
        const entry = live.handles.get(id)
        if (entry) {
          await entry.handle.close()
          live.handles.delete(id)
        }
        return { ok: true }
      }
      case 'fs.watch': {
        const path = asString(p.path)
        const stream = `w-${randomUUID()}`
        const watcher = fs.watch(path, { recursive: p.recursive === true }, (event, filename) => {
          writeLine(socket, {
            type: 'stream',
            stream,
            event: 'watch',
            data: {
              event,
              filename: filename == null ? null : filename.toString()
            }
          })
        })
        watcher.on('error', (err) => {
          writeLine(socket, {
            type: 'stream',
            stream,
            event: 'error',
            data: { message: err.message }
          })
        })
        live.watches.set(stream, { close: () => watcher.close() })
        return { stream }
      }
      case 'fs.unwatch': {
        const stream = asString(p.stream)
        live.watches.get(stream)?.close()
        live.watches.delete(stream)
        return { ok: true }
      }
      case 'process.spawn':
        return this.spawnProcess(p, socket, live.processes)
      case 'process.write': {
        const entry = live.processes.get(asString(p.stream))
        if (!entry?.child.stdin) throw new Error('unknown process')
        entry.child.stdin.write(Buffer.from(asString(p.base64), 'base64'))
        return { ok: true }
      }
      case 'process.end': {
        const entry = live.processes.get(asString(p.stream))
        if (!entry?.child.stdin) return { ok: false }
        entry.child.stdin.end()
        return { ok: true }
      }
      case 'process.kill': {
        const entry = live.processes.get(asString(p.stream))
        if (!entry) return { ok: false }
        const signal = asString(p.signal) as NodeJS.Signals | ''
        return { ok: entry.child.kill(signal || undefined) }
      }
      case 'process.unref': {
        live.processes.get(asString(p.stream))?.child.unref()
        return { ok: true }
      }
      case 'pty.spawn':
        return this.spawnPty(p, socket, live.ptys)
      case 'pty.write': {
        const entry = live.ptys.get(asString(p.stream))
        if (!entry) throw new Error('unknown pty')
        entry.proc.write(asString(p.data))
        return { ok: true }
      }
      case 'pty.resize': {
        const entry = live.ptys.get(asString(p.stream))
        if (!entry) throw new Error('unknown pty')
        entry.proc.resize(Number(p.cols) || 80, Number(p.rows) || 24)
        return { ok: true }
      }
      case 'pty.kill': {
        live.ptys.get(asString(p.stream))?.proc.kill(asString(p.signal) || undefined)
        return { ok: true }
      }
      case 'proc.which': {
        const candidates = Array.isArray(p.candidates)
          ? p.candidates.map((c) => String(c)).filter((c) => c.trim().length > 0)
          : []
        const path = await whichOnHost(this.opts.host, candidates)
        return { path }
      }
      default:
        throw new Error(`unknown method: ${method}`)
    }
  }

  private spawnProcess(
    p: Record<string, unknown>,
    socket: Socket,
    processes: Map<string, LiveProcess>
  ): { stream: string; pid?: number } {
    const file = asString(p.file)
    const args = Array.isArray(p.args) ? p.args.map((a) => String(a)) : []
    const opts = asRecord(p.opts)
    const envRaw = asRecord(opts.env)
    const env: NodeJS.ProcessEnv = {}
    for (const [key, value] of Object.entries(envRaw)) {
      if (typeof value === 'string') env[key] = value
    }
    const stdioRaw = opts.stdio
    const stdio = Array.isArray(stdioRaw)
      ? (stdioRaw.map((s) => (s === 'ignore' || s === 'inherit' ? s : 'pipe')) as [
          'pipe' | 'ignore' | 'inherit',
          'pipe' | 'ignore' | 'inherit',
          'pipe' | 'ignore' | 'inherit'
        ])
      : undefined
    const child = this.opts.host.process.spawn(file, args, {
      cwd: typeof opts.cwd === 'string' ? opts.cwd : undefined,
      env: Object.keys(env).length ? env : undefined,
      argv0: typeof opts.argv0 === 'string' ? opts.argv0 : undefined,
      stdio,
      detached: opts.detached === true,
      windowsHide: opts.windowsHide === true
    })
    const stream = `p-${randomUUID()}`
    processes.set(stream, { child })
    const push = (event: string, data?: unknown): void => {
      writeLine(socket, { type: 'stream', stream, event, data })
    }
    child.stdout?.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      push('stdout', { base64: buf.toString('base64') })
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      push('stderr', { base64: buf.toString('base64') })
    })
    child.on('error', (err) => push('error', { message: err.message }))
    child.on('exit', (code, signal) => push('exit', { code, signal }))
    child.on('close', (code, signal) => {
      push('close', { code, signal })
      processes.delete(stream)
    })
    return { stream, pid: child.pid }
  }

  private spawnPty(
    p: Record<string, unknown>,
    socket: Socket,
    ptys: Map<string, LivePty>
  ): { stream: string; pid: number } {
    const file = asString(p.file)
    const args = Array.isArray(p.args) ? p.args.map((a) => String(a)) : []
    const opts = asRecord(p.opts)
    const envRaw = asRecord(opts.env)
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(envRaw)) {
      if (typeof value === 'string') env[key] = value
    }
    const proc = this.opts.host.pty.spawn(file, args, {
      name: typeof opts.name === 'string' ? opts.name : undefined,
      cols: Number(opts.cols) || 80,
      rows: Number(opts.rows) || 24,
      cwd: typeof opts.cwd === 'string' ? opts.cwd : undefined,
      env: Object.keys(env).length ? env : undefined,
      useConpty: opts.useConpty === true
    })
    const stream = `t-${randomUUID()}`
    ptys.set(stream, { proc })
    proc.onData((data) => {
      writeLine(socket, { type: 'stream', stream, event: 'pty-data', data: { text: data } })
    })
    proc.onExit((e) => {
      writeLine(socket, {
        type: 'stream',
        stream,
        event: 'pty-exit',
        data: { exitCode: e.exitCode, signal: e.signal }
      })
      ptys.delete(stream)
    })
    return { stream, pid: proc.pid }
  }
}
