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
import { parseClientMessage, type RemoteHello } from '../../shared/remoteControl.ts'
import type { WorkspaceHost } from '../host/WorkspaceHost.ts'
import type { HostChild, HostPtyProcess, HostFileHandle } from '../host/index.ts'
import { attachLineReader, secretsMatch, writeLine } from './jsonLines.ts'
import type { DaemonIdentity } from './identity.ts'
import {
  createMemoryGrantStore,
  incomingFromGrants,
  type GrantStore,
  type IncomingController
} from './grants.ts'
import { whichOnHost } from './procWhich.ts'

type ServerOpts = {
  host: WorkspaceHost
  identity: DaemonIdentity
  secret: () => string
  appVersion: string
  home: string
  tmp: string
  /** This machine's `vav-daemon://` URI — sent after a LAN pair-ask is approved. */
  pairing?: (secret?: string) => string | null
  /** Desktop confirm for LAN Pair. Headless daemons omit this and refuse. */
  onPairAsk?: (from: { name: string; machineId: string }) => Promise<boolean>
  /** Issued grants. Defaults to an in-memory store so every pair can be revoked. */
  grants?: GrantStore
  /**
   * Extra offer secrets that can mint a grant (desktop phone QR after the
   * machine offer was rotated). Phone-role hellos also accept these without
   * minting — phones stay on the shared secret.
   */
  extraSecrets?: () => string[]
  onIncomingChanged?: () => void
  /**
   * Local sessions + folder recents on this computer. Headless `vavd` omits
   * this; list/get then return empty rather than failing the pair.
   */
  catalog?: DaemonWorkspaceCatalog
  /**
   * Phone-role hello on this listen port — hand the socket to the session
   * plane. Headless `vavd` omits this so a phone / desktop control client
   * is refused instead of being treated as a daemon.
   */
  onControlHello?: (socket: Socket, leftover: string, hello: RemoteHello) => void
}

/** Plain JSON catalog the desktop injects — DaemonServer stays Electron-free. */
export type DaemonWorkspaceCatalog = {
  listSessions: () => unknown[]
  getSession: (id: string) => unknown | null
  listRecents: () => string[]
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

/** Explicit LAN bind — used when the user opts into "allow other devices". */
export const DAEMON_LAN_BIND = '0.0.0.0'
/** Safe listen() default so a forgotten hostname is loopback-only. */
export const DAEMON_LOCAL_BIND = '127.0.0.1'

const AUTH_FAIL_LIMIT = 8
const AUTH_FAIL_WINDOW_MS = 60_000
const AUTH_LOCK_MS = 30_000

type LiveMeta = {
  dispose: () => void
  grantId: string | null
  clientId: string | null
  name: string
  role: 'daemon' | 'control'
}

export class DaemonServer {
  private readonly opts: ServerOpts
  private readonly grants: GrantStore
  private server: Server | null = null
  private readonly sockets = new Set<Socket>()
  private readonly sessions = new Set<() => void>()
  private readonly live = new Map<Socket, LiveMeta>()
  private listenPort = 0
  private pairAskBusy = false
  private pendingAsk: IncomingController | null = null
  private readonly revoked = new Map<string, IncomingController>()
  private readonly authFails = new Map<
    string,
    { count: number; windowStart: number; lockedUntil: number }
  >()

  constructor(opts: ServerOpts) {
    this.opts = opts
    this.grants = opts.grants ?? createMemoryGrantStore()
  }

  incoming(): IncomingController[] {
    const extras: IncomingController[] = []
    if (this.pendingAsk) extras.push(this.pendingAsk)
    extras.push(...this.revoked.values())
    return incomingFromGrants(this.grants.list(), this.onlineGrantIds(), extras)
  }

  disconnectGrant(grantId: string): boolean {
    const grant = this.grants.findById(grantId)
    if (!grant) return false
    this.grants.markKicked(grantId)
    this.dropGrantSockets(grantId, 'disconnected')
    this.notifyIncoming()
    return true
  }

  unpairGrant(grantId: string): boolean {
    const grant = this.grants.remove(grantId) ?? this.pendingAsk
    this.dropGrantSockets(grantId, 'revoked')
    if (this.pendingAsk?.id === grantId) this.pendingAsk = null
    if (grant && 'secret' in grant) {
      this.revoked.set(grantId, {
        id: grant.id,
        name: grant.name,
        clientId: grant.clientId,
        state: 'revoked',
        online: false,
        lastSeen: Date.now(),
        issuedAt: grant.issuedAt
      })
    } else if (grant) {
      this.revoked.set(grantId, { ...grant, state: 'revoked', online: false, lastSeen: Date.now() })
    }
    if (grant) this.notifyIncoming()
    return Boolean(grant)
  }

  port(): number {
    return this.listenPort
  }

  listen(port: number, hostname = DAEMON_LOCAL_BIND): Promise<number> {
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
  adopt(socket: Socket, leftover = '', hello?: { auth: string; device?: string }): void {
    this.attachSession(socket, leftover, true, hello)
  }

  close(): void {
    for (const dispose of [...this.sessions]) dispose()
    this.sessions.clear()
    for (const socket of this.sockets) {
      try {
        if (typeof socket.resetAndDestroy === 'function') socket.resetAndDestroy()
        else socket.destroy()
        socket.unref()
      } catch {
        /* ignore */
      }
    }
    this.sockets.clear()
    this.live.clear()
    this.authFails.clear()
    const server = this.server
    this.server = null
    this.listenPort = 0
    if (!server) return
    // Windows keeps `server.close()` pending until every TCP connection
    // actually drops. Force them so the test worker (and the app) can exit.
    const closer = server as typeof server & { closeAllConnections?: () => void }
    closer.closeAllConnections?.()
    server.close()
    server.unref()
  }

  private authKey(socket: Socket): string {
    return socket.remoteAddress || 'unknown'
  }

  private authLocked(socket: Socket): boolean {
    const rec = this.authFails.get(this.authKey(socket))
    return Boolean(rec && rec.lockedUntil > Date.now())
  }

  private onlineGrantIds(): Set<string> {
    const ids = new Set<string>()
    for (const meta of this.live.values()) {
      if (meta.grantId) ids.add(meta.grantId)
    }
    return ids
  }

  private notifyIncoming(): void {
    this.opts.onIncomingChanged?.()
  }

  private clearRevoked(clientId: string): void {
    for (const [id, row] of this.revoked) {
      if (row.clientId === clientId) this.revoked.delete(id)
    }
  }

  private offerSecrets(): string[] {
    const extra = this.opts.extraSecrets?.() ?? []
    return [this.opts.secret(), ...extra].filter((secret) => secret.length >= 16)
  }

  private matchesOffer(auth: string): boolean {
    return this.offerSecrets().some((secret) => secretsMatch(auth, secret))
  }

  private dropGrantSockets(grantId: string, reason: 'revoked' | 'disconnected'): number {
    let n = 0
    for (const [socket, meta] of [...this.live]) {
      if (meta.grantId !== grantId) continue
      n += 1
      writeLine(socket, {
        type: 'error',
        code: reason === 'revoked' ? 'revoked' : 'auth',
        message: reason === 'revoked' ? 'pairing revoked' : 'disconnected'
      })
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
    }
    return n
  }

  private noteAuthFail(socket: Socket): void {
    const key = this.authKey(socket)
    const now = Date.now()
    const rec = this.authFails.get(key) ?? { count: 0, windowStart: now, lockedUntil: 0 }
    if (now - rec.windowStart > AUTH_FAIL_WINDOW_MS) {
      rec.count = 0
      rec.windowStart = now
    }
    rec.count += 1
    if (rec.count >= AUTH_FAIL_LIMIT) rec.lockedUntil = now + AUTH_LOCK_MS
    this.authFails.set(key, rec)
  }

  private accept(socket: Socket): void {
    this.attachSession(socket, '', false)
  }

  private authenticateDaemonHello(
    socket: Socket,
    hello: { auth: string; device?: string; clientId?: string; grantId?: string },
    meta: LiveMeta,
    sendWelcome: (grant?: { id: string; secret: string }) => void
  ): boolean {
    const existing = this.grants.findBySecret(hello.auth)
    if (existing) {
      this.authFails.delete(this.authKey(socket))
      this.grants.touch(existing.id, hello.device)
      this.clearRevoked(existing.clientId)
      meta.grantId = existing.id
      meta.clientId = existing.clientId
      meta.name = existing.name
      meta.role = 'daemon'
      sendWelcome({ id: existing.id, secret: existing.secret })
      this.notifyIncoming()
      return true
    }
    if (!this.matchesOffer(hello.auth)) return false
    this.authFails.delete(this.authKey(socket))
    const grant = this.grants.issue({
      clientId: hello.clientId || hello.grantId || hello.device || randomUUID(),
      name: hello.device || 'unknown'
    })
    this.clearRevoked(grant.clientId)
    meta.grantId = grant.id
    meta.clientId = grant.clientId
    meta.name = grant.name
    meta.role = 'daemon'
    sendWelcome({ id: grant.id, secret: grant.secret })
    this.notifyIncoming()
    return true
  }

  private attachSession(
    socket: Socket,
    leftover: string,
    authed: boolean,
    adoptedHello?: { auth: string; device?: string }
  ): void {
    this.sockets.add(socket)
    const processes = new Map<string, LiveProcess>()
    const ptys = new Map<string, LivePty>()
    const handles = new Map<string, LiveHandle>()
    const watches = new Map<string, LiveWatch>()
    let ready = authed

    const meta: LiveMeta = {
      dispose: () => undefined,
      grantId: null,
      clientId: null,
      name: '',
      role: 'daemon'
    }

    const forget = (): void => {
      if (!this.sessions.delete(forget)) return
      this.sockets.delete(socket)
      this.live.delete(socket)
      this.notifyIncoming()
      for (const live of processes.values()) {
        try {
          live.child.kill()
          live.child.unref()
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
    meta.dispose = forget
    this.sessions.add(forget)
    socket.on('close', forget)
    socket.on('error', forget)
    this.live.set(socket, meta)

    const sendWelcome = (grant?: { id: string; secret: string }): void => {
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
        tmp: this.opts.tmp,
        grant
      })
    }

    if (ready) {
      if (adoptedHello) this.authenticateDaemonHello(socket, adoptedHello, meta, sendWelcome)
      else sendWelcome()
    }

    const leftoverRef = { value: leftover }
    attachLineReader(socket, (value) => {
      if (value === null) {
        writeLine(socket, { type: 'error', code: 'bad-request', message: 'invalid json' })
        socket.destroy()
        return
      }
      if (!ready) {
        if (this.authLocked(socket)) {
          writeLine(socket, { type: 'error', code: 'auth', message: 'pairing rejected' })
          socket.destroy()
          return
        }
        const ask = parseDaemonPairAsk(value)
        if (ask) {
          void this.handlePairAsk(socket, ask)
          return
        }
        const hello = parseDaemonHello(value)
        if (hello) {
          const granted = this.authenticateDaemonHello(socket, hello, meta, sendWelcome)
          if (granted) {
            ready = true
            return
          }
        }
        const phone = parseClientMessage(value)
        if (phone?.type === 'hello' && phone.role !== 'daemon') {
          const grant = this.grants.findBySecret(phone.auth)
          const offerOk = this.matchesOffer(phone.auth)
          if (grant || offerOk) {
            if (!this.opts.onControlHello) {
              writeLine(socket, {
                type: 'error',
                code: 'bad-request',
                message: 'control plane not available'
              })
              socket.destroy()
              return
            }
            this.authFails.delete(this.authKey(socket))
            if (grant) {
              this.grants.touch(grant.id, phone.device)
              meta.grantId = grant.id
              meta.clientId = grant.clientId
              meta.name = grant.name
              meta.role = 'control'
              this.notifyIncoming()
            }
            socket.removeAllListeners('data')
            this.opts.onControlHello(socket, leftoverRef.value, phone)
            return
          }
        }
        this.noteAuthFail(socket)
        writeLine(socket, { type: 'error', code: 'auth', message: 'pairing rejected' })
        socket.destroy()
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
      void this.dispatch(frame, socket, { processes, ptys, handles, watches, grantId: () => meta.grantId })
    }, { leftover, leftoverRef })
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
    this.pendingAsk = {
      id: `pending:${ask.machineId}`,
      name: ask.name,
      clientId: ask.machineId,
      state: 'pending',
      online: false,
      lastSeen: Date.now(),
      issuedAt: Date.now()
    }
    this.notifyIncoming()
    try {
      const allow = await new Promise<boolean | 'closed'>((resolve) => {
        if (socket.destroyed) {
          resolve('closed')
          return
        }
        const onClose = (): void => resolve('closed')
        socket.once('close', onClose)
        void this.opts.onPairAsk!({ name: ask.name, machineId: ask.machineId }).then(
          (value) => {
            socket.off('close', onClose)
            resolve(value)
          },
          () => {
            socket.off('close', onClose)
            resolve(false)
          }
        )
      })
      if (allow === 'closed' || socket.destroyed) return
      if (!allow) {
        writeLine(socket, { type: 'error', code: 'auth', message: 'pairing declined' })
        socket.destroy()
        return
      }
      const grant = this.grants.issue({ clientId: ask.machineId, name: ask.name })
      const pairing = this.opts.pairing?.(grant.secret)
      if (!pairing) {
        writeLine(socket, { type: 'error', code: 'internal', message: 'not listening' })
        socket.destroy()
        return
      }
      this.notifyIncoming()
      writeLine(socket, { type: 'pair-offer', pairing })
      socket.end()
    } finally {
      this.pendingAsk = null
      this.pairAskBusy = false
      this.notifyIncoming()
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
      grantId: () => string | null
    }
  ): Promise<void> {
    try {
      const result = await this.runMethod(req.method, req.params, socket, live)
      writeLine(socket, { type: 'res', id: req.id, ok: true, result })
      if (req.method === 'pair.leave') {
        const grantId = live.grantId()
        if (grantId) this.unpairGrant(grantId)
        else socket.destroy()
      }
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
      grantId: () => string | null
    }
  ): Promise<unknown> {
    const p = asRecord(params)
    const fs = this.opts.host.fs
    switch (method) {
      case 'pair.leave':
        return { ok: true }
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
      case 'sessions.list': {
        const listed = this.opts.catalog?.listSessions() ?? []
        const sessions = Array.isArray(listed) ? listed.slice(0, 100) : []
        return { sessions }
      }
      case 'sessions.get': {
        const id = asString(p.id)
        if (!id) return { conversation: null }
        const conversation = this.opts.catalog?.getSession(id) ?? null
        if (conversation == null) return { conversation: null }
        const encoded = JSON.stringify(conversation)
        if (Buffer.byteLength(encoded) > 6 * 1024 * 1024) {
          throw new Error('session exceeds daemon read cap (6MB)')
        }
        return { conversation: JSON.parse(encoded) as unknown }
      }
      case 'workspace.recents': {
        const listed = this.opts.catalog?.listRecents() ?? []
        const paths = Array.isArray(listed)
          ? listed.filter((path): path is string => typeof path === 'string' && path.trim().length > 0).slice(0, 30)
          : []
        return { paths }
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
      try {
        proc.kill()
      } catch {
        /* ConPTY/worker teardown is idempotent */
      }
      ptys.delete(stream)
    })
    return { stream, pid: proc.pid }
  }
}
