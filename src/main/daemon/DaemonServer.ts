/**
 * Serves a WorkspaceHost over the daemon JSON-line protocol.
 *
 * Used by headless `vav-server` and by desktop VAV when other machines attach.
 * Electron-free — only Node + the Host* interfaces.
 */

import { spawn } from 'node:child_process'
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
import {
  copyAsFileSpawn,
  getInfoSpawn,
  openSpawn,
  previewSpawn,
  revealSpawn
} from '../host/hostShell.ts'
import type { HostChild, HostPtyProcess, HostFileHandle } from '../host/index.ts'
import { attachLineReader, secretsMatch, writeLine } from './jsonLines.ts'
import type { DaemonIdentity } from './identity.ts'
import {
  createMemoryGrantStore,
  incomingFromGrants,
  type GrantStore,
  type IncomingController
} from './grants.ts'
import { emptyPluginSnapshot, pluginHostKind } from '../../shared/plugins.ts'
import { whichOnHost } from './procWhich.ts'
import {
  checkoutGitBranch,
  createGitBranch,
  createGitWorktree,
  getGitDiff,
  getGitShowBase64,
  getGitSnapshot,
  initGitRepo
} from '../git/GitService.ts'
import {
  getGithubActionRun,
  getGithubPull,
  getGithubSite,
  listGithubActions,
  listGithubPulls,
  listGithubReleases
} from '../github/GithubService.ts'
import {
  isLogChannel,
  isLogRetentionClass,
  type AppLogClearScope,
  type AppLogInput,
  type AppLogQuery,
  type AppLogRecord,
  type AppLogStats
} from '../../shared/appLog.ts'

type ServerOpts = {
  host: WorkspaceHost
  identity: DaemonIdentity
  secret: () => string
  appVersion: string
  home: string
  tmp: string
  /** This machine's `vavrtp://` URI — sent after a LAN pair-ask is approved. */
  pairing?: (secret?: string) => string | null
  /**
   * Mint a new offer secret and return the current `vavrtp://` line.
   * Existing grants stay valid. Chrome / desktop / `vav-board host rotate` share this.
   */
  rotateOffer?: () => string | null | Promise<string | null>
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
   * Local sessions + folder recents on this computer. Optional for a
   * workspace-only listen; `vav-server` supplies the control-plane catalog.
   */
  catalog?: DaemonWorkspaceCatalog
  /**
   * Control-plane diagnostic logs. `vav-server` supplies the plane's LogStore;
   * a workspace-only listen omits this and the RPCs return empty.
   */
  logs?: DaemonLogCatalog
  /** Host plugin catalog (skills / MCP / hooks). Chrome Git already uses git.*. */
  plugins?: DaemonPluginCatalog
  /** Scheduled jobs on this control plane. Chrome / vav-board list the same rows as desktop. */
  timers?: DaemonTimerCatalog
  /** Connector catalog + vendor status (GitHub / CF / Supabase / Vercel). */
  connectors?: DaemonConnectorCatalog
  /** File-preview multi-session store — Chrome / web Files tray matches desktop. */
  fileSessions?: DaemonFileSessionCatalog
  /** Accept / reject the pending change-review set — same store desktop paints. */
  changeSets?: DaemonChangeSetCatalog
  /** Provider accounts + keys. Chrome Settings and desktop IPC share this store. */
  accounts?: DaemonAccountsCatalog
  /** Host-relevant preferences (model / agents / trays). Appearance stays on the client. */
  settings?: DaemonSettingsCatalog
  /**
   * Phone-role hello on this listen port — hand the socket to the session
   * plane. Omit only for a workspace-only listen (tests). `vav-server` always
   * supplies this so phone / web / extension / desktop-connect share one port.
   */
  onControlHello?: (socket: Socket, leftover: string, hello: RemoteHello) => void
  /**
   * Finder / default-app / Get Info / clipboard-file. Tests inject a spy so
   * `fs.reveal` does not open a real file manager. Production detaches.
   */
  hostFileSpawn?: DaemonHostFileSpawn
}

/** Plain JSON catalog the desktop injects — DaemonServer stays Electron-free. */
export type DaemonWorkspaceCatalog = {
  listSessions: () => unknown[]
  getSession: (id: string) => unknown | null
  listRecents: () => string[]
}

/** Host plugin snapshot the Chrome / web Files → Plugins tab reads. */
export type DaemonPluginCatalog = {
  snapshot: (host?: string | null) => unknown
  setEnabled: (host: string, pluginId: string, enabled: boolean) => unknown
  create: (kind: string, name: string) => unknown
  writeConfig: (path: string, content: string) => unknown
}

/** Scheduled jobs the Chrome / web sidebar and `vav-board timers` read. */
export type DaemonTimerCatalog = {
  listJobs: () => unknown
  createScheduled: () => unknown
  getJobForConversation: (conversationId: string) => unknown
  createJob: (input: unknown) => unknown
  updateJob: (id: string, patch: unknown) => unknown
  removeJob: (id: string) => unknown
  runNow: (id: string) => unknown
  listRuns: (jobId?: string) => unknown
  listSessions: () => unknown
}

/** File-preview sessions the Chrome / web Files tray switcher reads. */
export type DaemonFileSessionCatalog = {
  open: (path: string) => Promise<unknown>
  create: (path: string) => Promise<unknown>
  setActive: (fileId: string, sessionId: string) => unknown
  list: (fileId: string) => unknown
  listAll: () => unknown
  resolve: (fileId: string) => unknown
  rename: (fileId: string, sessionId: string, title: string) => unknown
  delete: (fileId: string, sessionIds: string[]) => unknown
  forceDelete: (fileId: string, sessionIds: string[]) => unknown
  setReadOnly: (sessionId: string, readOnly: boolean) => void
}

/** Host settings Chrome / desktop IPC / `vav-board settings` share when the workbench is a shell. */
export type DaemonSettingsCatalog = {
  get: () => unknown
  update: (patch: Record<string, unknown>) => unknown
  reset: () => unknown
  setSecret: (slot: string, value: string) => unknown
  secretHint: (slot: string) => string | null
  revealSecret: (slot: string) => string | null
}

/** Provider accounts the Chrome / web Settings window and `vav-board account` read. */
export type DaemonAccountsCatalog = {
  getPage: (workspaceKey?: string) => unknown
  createVav: (input: {
    name?: string
    endpoint?: string
    apiKey?: string
    agentId?: string
    provider?: string
  }) => Promise<unknown>
  createDraft: (input: { agentId?: string; kind?: string; endpoint?: string }) => unknown
  updateVav: (
    id: string,
    patch: { alias?: string | null; endpoint?: string; apiKey?: string }
  ) => unknown
  setCurrent: (id: string) => unknown
  activate: (id: string) => Promise<unknown>
  remove: (id: string) => unknown
  verify: (id: string, apiKey?: string) => Promise<unknown>
  revealKey: (id: string) => string | null
  beginOAuth: (agentId: string, accountId?: string) => Promise<unknown>
  cancelOAuth: (agentId: string) => unknown
  signOut: (agentId: string) => Promise<unknown>
}

/** Change-review Accept / Reject the Chrome / web transcript uses. */
export type DaemonChangeSetCatalog = {
  get: (id: string) => unknown
  active: (conversationId: string) => unknown
  /**
   * Freeze the deterministic 2-file smoke review onto this conversation.
   * Desktop e2e calls this after the local shell is paired so Accept lives
   * on the same ChangeSetStore Chrome / web already read.
   */
  seedReview?: (conversationId: string) => Promise<unknown>
  accept: (setId: string, filePaths: string[]) => unknown
  reject: (setId: string, filePaths: string[]) => unknown
  acceptAll: (setId: string) => unknown
  rejectAll: (setId: string) => unknown
  undo: (setId: string, filePath: string) => unknown
  applyEdit: (setId: string, filePath: string, content: string) => unknown
}

/** Connector + vendor-status RPCs so Chrome Settings / workspace panels match desktop. */
export type DaemonConnectorCatalog = {
  catalog: () => unknown
  probe: (cwd: string) => Promise<unknown>
  act: (request: unknown) => Promise<unknown>
  authStatus: () => Promise<unknown>
  beginLogin: (id: string) => Promise<unknown>
  cancelLogin: (id?: string) => Promise<unknown>
  cloudflareStatus: (cwd: string, query?: unknown) => Promise<unknown>
  supabaseStatus: (cwd: string, query?: unknown) => Promise<unknown>
  vercelStatus: (cwd: string, query?: unknown) => Promise<unknown>
}

/** vav-server LogStore surface — Settings → Logs is a client of this sink. */
export type DaemonLogCatalog = {
  query: (query?: AppLogQuery) => AppLogRecord[]
  stats: () => AppLogStats
  clear: (scope: AppLogClearScope) => number
  exportText: (query?: AppLogQuery) => string
  append: (input: AppLogInput) => AppLogRecord | null
  subscribe: (fn: (record: AppLogRecord) => void) => () => void
}

const EMPTY_LOG_STATS: AppLogStats = { ephemeral: 0, session: 0, durable: 0, total: 0 }

type LiveProcess = {
  child: HostChild
  socket: Socket | null
}

type LivePty = {
  proc: HostPtyProcess
  socket: Socket | null
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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((row) => String(row)) : []
}

export type DaemonHostFileSpawn = (file: string, args: string[]) => void

function defaultHostFileSpawn(file: string, args: string[]): void {
  try {
    const child = spawn(file, args, {
      stdio: 'ignore',
      detached: true,
      windowsHide: true
    })
    child.unref()
    child.on('error', () => undefined)
  } catch {
    /* host may lack the helper */
  }
}

function sanitizeLogQuery(params: Record<string, unknown>): AppLogQuery {
  const channel =
    params.channel === 'all' || isLogChannel(params.channel) ? params.channel : undefined
  const retention =
    params.retention === 'all' || isLogRetentionClass(params.retention)
      ? params.retention
      : undefined
  return {
    channel,
    retention,
    conversationId: typeof params.conversationId === 'string' ? params.conversationId : undefined,
    search: typeof params.search === 'string' ? params.search : undefined,
    since: typeof params.since === 'number' ? params.since : undefined,
    until: typeof params.until === 'number' ? params.until : undefined,
    limit: typeof params.limit === 'number' ? params.limit : undefined
  }
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
  /** PTYs and spawned processes live on the daemon, not the client socket. */
  private readonly processes = new Map<string, LiveProcess>()
  private readonly ptys = new Map<string, LivePty>()
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

  private spawnHostFile(
    cmd: { file: string; args: string[] } | null,
    missing: string
  ): { ok: true } {
    if (!cmd) throw new Error(missing)
    const spawnFile = this.opts.hostFileSpawn ?? defaultHostFileSpawn
    spawnFile(cmd.file, cmd.args)
    return { ok: true }
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

  /**
   * Fresh inbound socket (loopback WebSocket). First line must be hello;
   * `role: 'daemon'` stays here, phone/omitted role is handed to the hub.
   */
  attachIncoming(socket: Socket, leftover = ''): void {
    this.attachSession(socket, leftover, false)
  }

  close(): void {
    for (const dispose of [...this.sessions]) dispose()
    this.sessions.clear()
    for (const live of this.processes.values()) {
      try {
        live.child.kill()
        live.child.unref()
      } catch {
        /* ignore */
      }
    }
    this.processes.clear()
    for (const live of this.ptys.values()) {
      try {
        live.proc.kill()
      } catch {
        /* ignore */
      }
    }
    this.ptys.clear()
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
    const controllers = this.incoming()
    for (const [socket, meta] of this.live) {
      if (meta.role !== 'daemon') continue
      writeLine(socket, {
        type: 'stream',
        stream: 'incoming',
        event: 'changed',
        data: { controllers }
      })
    }
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
      for (const live of this.processes.values()) {
        if (live.socket === socket) live.socket = null
      }
      for (const live of this.ptys.values()) {
        if (live.socket === socket) live.socket = null
      }
      for (const live of handles.values()) {
        void live.handle.close()
      }
      for (const live of watches.values()) live.close()
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
        app: 'vav-server',
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
      void this.dispatch(frame, socket, { handles, watches, grantId: () => meta.grantId })
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
      case 'host.pairing':
        return { pairing: this.opts.pairing?.() ?? null }
      case 'host.rotateOffer': {
        if (!this.opts.rotateOffer) throw new Error('host does not rotate offers')
        return { pairing: (await this.opts.rotateOffer()) ?? null }
      }
      case 'host.incoming':
        return { controllers: this.incoming() }
      case 'host.disconnectIncoming': {
        const grantId = asString(p.grantId || p.id)
        return { ok: this.disconnectGrant(grantId) }
      }
      case 'host.unpairIncoming': {
        const grantId = asString(p.grantId || p.id)
        return { ok: this.unpairGrant(grantId) }
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
      case 'fs.reveal': {
        const path = asString(p.path)
        if (!path) throw new Error('empty path')
        let isDirectory = false
        try {
          isDirectory = (await fs.stat(path)).isDirectory()
        } catch {
          /* still try to reveal */
        }
        return this.spawnHostFile(
          revealSpawn(this.opts.host.info.platform, path, isDirectory),
          'reveal unavailable'
        )
      }
      case 'fs.openPath': {
        const path = asString(p.path)
        if (!path) throw new Error('empty path')
        return this.spawnHostFile(openSpawn(this.opts.host.info.platform, path), 'open unavailable')
      }
      case 'fs.preview': {
        const path = asString(p.path)
        if (!path) throw new Error('empty path')
        return this.spawnHostFile(
          previewSpawn(this.opts.host.info.platform, path),
          'preview unavailable'
        )
      }
      case 'fs.getInfo': {
        const path = asString(p.path)
        if (!path) throw new Error('empty path')
        return this.spawnHostFile(
          getInfoSpawn(this.opts.host.info.platform, path),
          'Get Info is only available on macOS and Windows'
        )
      }
      case 'fs.copyAsFile': {
        const paths = asStringArray(p.paths).filter(Boolean)
        if (paths.length === 0) {
          const single = asString(p.path)
          if (single) paths.push(single)
        }
        if (paths.length === 0) throw new Error('no paths')
        return this.spawnHostFile(
          copyAsFileSpawn(this.opts.host.info.platform, paths),
          'Copy file is only available on macOS and Windows'
        )
      }
      case 'process.spawn':
        return this.spawnProcess(p, socket)
      case 'process.write': {
        const entry = this.processes.get(asString(p.stream))
        if (!entry?.child.stdin) throw new Error('unknown process')
        entry.child.stdin.write(Buffer.from(asString(p.base64), 'base64'))
        return { ok: true }
      }
      case 'process.end': {
        const entry = this.processes.get(asString(p.stream))
        if (!entry?.child.stdin) return { ok: false }
        entry.child.stdin.end()
        return { ok: true }
      }
      case 'process.kill': {
        const entry = this.processes.get(asString(p.stream))
        if (!entry) return { ok: false }
        const signal = asString(p.signal) as NodeJS.Signals | ''
        return { ok: entry.child.kill(signal || undefined) }
      }
      case 'process.unref': {
        this.processes.get(asString(p.stream))?.child.unref()
        return { ok: true }
      }
      case 'pty.spawn':
        return this.spawnPty(p, socket)
      case 'pty.write': {
        const entry = this.ptys.get(asString(p.stream))
        if (!entry) throw new Error('unknown pty')
        entry.proc.write(asString(p.data))
        return { ok: true }
      }
      case 'pty.resize': {
        const entry = this.ptys.get(asString(p.stream))
        if (!entry) throw new Error('unknown pty')
        entry.proc.resize(Number(p.cols) || 80, Number(p.rows) || 24)
        return { ok: true }
      }
      case 'pty.kill': {
        this.ptys.get(asString(p.stream))?.proc.kill(asString(p.signal) || undefined)
        return { ok: true }
      }
      case 'plugins.list':
        return (
          this.opts.plugins?.snapshot(asString(p.host) || null) ??
          emptyPluginSnapshot(pluginHostKind(asString(p.host) || null))
        )
      case 'plugins.setEnabled': {
        if (!this.opts.plugins) return { ok: false, error: 'unavailable' }
        return this.opts.plugins.setEnabled(
          asString(p.host) || 'vav',
          asString(p.pluginId) || asString(p.id),
          p.enabled === true
        )
      }
      case 'plugins.create': {
        if (!this.opts.plugins) return { ok: false, error: 'unavailable' }
        return this.opts.plugins.create(asString(p.kind), asString(p.name))
      }
      case 'plugins.write': {
        if (!this.opts.plugins) return { ok: false, error: 'unavailable' }
        return this.opts.plugins.writeConfig(asString(p.path), asString(p.content))
      }
      case 'fileSessions.open':
        return this.opts.fileSessions?.open(asString(p.path)) ?? null
      case 'fileSessions.create':
        return this.opts.fileSessions?.create(asString(p.path)) ?? null
      case 'fileSessions.setActive':
        return this.opts.fileSessions?.setActive(asString(p.fileId), asString(p.sessionId)) ?? null
      case 'fileSessions.list':
        return this.opts.fileSessions?.list(asString(p.fileId)) ?? null
      case 'fileSessions.listAll':
        return this.opts.fileSessions?.listAll() ?? []
      case 'fileSessions.resolve':
        return this.opts.fileSessions?.resolve(asString(p.fileId)) ?? null
      case 'fileSessions.rename':
        return (
          this.opts.fileSessions?.rename(asString(p.fileId), asString(p.sessionId), asString(p.title)) ??
          null
        )
      case 'fileSessions.delete': {
        const ids = Array.isArray(p.sessionIds) ? p.sessionIds.map((id) => String(id)) : []
        return this.opts.fileSessions?.delete(asString(p.fileId), ids) ?? null
      }
      case 'fileSessions.forceDelete': {
        const ids = Array.isArray(p.sessionIds) ? p.sessionIds.map((id) => String(id)) : []
        return this.opts.fileSessions?.forceDelete(asString(p.fileId), ids) ?? { ok: true, removed: [] }
      }
      case 'fileSessions.setReadOnly':
        this.opts.fileSessions?.setReadOnly(asString(p.sessionId), p.readOnly === true)
        return { ok: true }
      case 'accounts.getPage':
        return (
          this.opts.accounts?.getPage(asString(p.workspaceKey) || undefined) ?? {
            workspaceKey: '',
            workspaceLabel: '',
            groups: [],
            accounts: [],
            usage: []
          }
        )
      case 'accounts.createVav': {
        if (!this.opts.accounts) throw new Error('unavailable')
        return this.opts.accounts.createVav({
          name: asString(p.name),
          endpoint: asString(p.endpoint),
          apiKey: asString(p.apiKey),
          agentId: asString(p.agentId) || undefined,
          provider: asString(p.provider) || undefined
        })
      }
      case 'accounts.createDraft': {
        if (!this.opts.accounts) throw new Error('unavailable')
        return this.opts.accounts.createDraft({
          agentId: asString(p.agentId) || undefined,
          kind: asString(p.kind) || undefined,
          endpoint: asString(p.endpoint) || undefined
        })
      }
      case 'accounts.updateVav': {
        if (!this.opts.accounts) throw new Error('unavailable')
        return this.opts.accounts.updateVav(asString(p.id), {
          alias: typeof p.alias === 'string' || p.alias === null ? p.alias : undefined,
          endpoint: typeof p.endpoint === 'string' ? p.endpoint : undefined,
          apiKey: typeof p.apiKey === 'string' ? p.apiKey : undefined
        })
      }
      case 'accounts.setCurrent': {
        if (!this.opts.accounts) throw new Error('unavailable')
        return this.opts.accounts.setCurrent(asString(p.id))
      }
      case 'accounts.activate': {
        if (!this.opts.accounts) throw new Error('unavailable')
        return this.opts.accounts.activate(asString(p.id))
      }
      case 'accounts.remove': {
        if (!this.opts.accounts) throw new Error('unavailable')
        return this.opts.accounts.remove(asString(p.id))
      }
      case 'accounts.verify': {
        if (!this.opts.accounts) throw new Error('unavailable')
        return this.opts.accounts.verify(asString(p.id), asString(p.apiKey) || undefined)
      }
      case 'accounts.revealKey':
        return { key: this.opts.accounts?.revealKey(asString(p.id)) ?? null }
      case 'accounts.beginOAuth': {
        if (!this.opts.accounts) throw new Error('unavailable')
        return this.opts.accounts.beginOAuth(
          asString(p.agentId),
          asString(p.accountId) || undefined
        )
      }
      case 'accounts.cancelOAuth': {
        if (!this.opts.accounts) throw new Error('unavailable')
        return this.opts.accounts.cancelOAuth(asString(p.agentId))
      }
      case 'accounts.signOut': {
        if (!this.opts.accounts) throw new Error('unavailable')
        return this.opts.accounts.signOut(asString(p.agentId))
      }
      case 'settings.get':
        return this.opts.settings?.get() ?? {}
      case 'settings.update':
        return this.opts.settings?.update(p) ?? {}
      case 'settings.reset':
        return this.opts.settings?.reset() ?? {}
      case 'settings.setSecret': {
        if (!this.opts.settings) throw new Error('unavailable')
        return this.opts.settings.setSecret(asString(p.slot), asString(p.value))
      }
      case 'settings.secretHint':
        return { hint: this.opts.settings?.secretHint(asString(p.slot)) ?? null }
      case 'settings.revealSecret':
        return { key: this.opts.settings?.revealSecret(asString(p.slot)) ?? null }
      case 'changeSets.get':
        return this.opts.changeSets?.get(asString(p.id)) ?? null
      case 'changeSets.active':
        return this.opts.changeSets?.active(asString(p.conversationId)) ?? null
      case 'changeSets.seedReview': {
        if (!this.opts.changeSets?.seedReview) throw new Error('unavailable')
        return this.opts.changeSets.seedReview(asString(p.conversationId))
      }
      case 'changeSets.accept':
        return this.opts.changeSets?.accept(asString(p.setId), asStringArray(p.filePaths)) ?? null
      case 'changeSets.reject':
        return this.opts.changeSets?.reject(asString(p.setId), asStringArray(p.filePaths)) ?? null
      case 'changeSets.acceptAll':
        return this.opts.changeSets?.acceptAll(asString(p.setId)) ?? null
      case 'changeSets.rejectAll':
        return this.opts.changeSets?.rejectAll(asString(p.setId)) ?? null
      case 'changeSets.undo':
        return this.opts.changeSets?.undo(asString(p.setId), asString(p.filePath)) ?? null
      case 'changeSets.applyEdit':
        return (
          this.opts.changeSets?.applyEdit(asString(p.setId), asString(p.filePath), asString(p.content)) ??
          null
        )
      case 'git.status':
        return getGitSnapshot(asString(p.cwd), asString(p.conversationId) || undefined)
      case 'git.diff':
        return getGitDiff(asString(p.cwd), asString(p.path), {
          staged: p.staged === true,
          conversationId: asString(p.conversationId) || undefined
        })
      case 'git.showBase64':
        return getGitShowBase64(
          asString(p.cwd),
          asString(p.path),
          asString(p.ref) || 'HEAD',
          asString(p.conversationId) || undefined
        )
      case 'git.init':
        return initGitRepo(asString(p.cwd), asString(p.conversationId) || undefined)
      case 'git.createBranch':
        return createGitBranch(asString(p.cwd), asString(p.name), {
          checkout: p.checkout === true,
          conversationId: asString(p.conversationId) || undefined
        })
      case 'git.checkoutBranch':
        return checkoutGitBranch(
          asString(p.cwd),
          asString(p.name),
          asString(p.conversationId) || undefined
        )
      case 'git.createWorktree':
        return createGitWorktree(
          asString(p.cwd),
          {
            path: asString(p.path),
            newBranch: asString(p.newBranch) || undefined,
            branch: asString(p.branch) || undefined
          },
          asString(p.conversationId) || undefined
        )
      case 'github.listPulls':
        return listGithubPulls(
          asString(p.cwd),
          p.state === 'closed' || p.state === 'all' || p.state === 'open' ? p.state : 'open'
        )
      case 'github.getPull':
        return getGithubPull(asString(p.cwd), Number(p.number) || 0)
      case 'github.listActions':
        return listGithubActions(
          asString(p.cwd),
          p.scope === 'history' || p.scope === 'running' ? p.scope : undefined
        )
      case 'github.getActionRun':
        return getGithubActionRun(asString(p.cwd), Number(p.runId) || 0)
      case 'github.getSite':
        return getGithubSite(asString(p.cwd))
      case 'github.listReleases':
        return listGithubReleases(asString(p.cwd))
      case 'timers.listJobs':
        return this.opts.timers?.listJobs() ?? []
      case 'timers.createScheduled': {
        if (!this.opts.timers) return { ok: false, error: 'unavailable' }
        return this.opts.timers.createScheduled()
      }
      case 'timers.getJobForConversation':
        return this.opts.timers?.getJobForConversation(asString(p.conversationId) || asString(p.id)) ?? null
      case 'timers.createJob': {
        if (!this.opts.timers) return { ok: false, error: 'unavailable' }
        return this.opts.timers.createJob(p.input ?? p)
      }
      case 'timers.updateJob': {
        if (!this.opts.timers) return { ok: false, error: 'unavailable' }
        return this.opts.timers.updateJob(asString(p.id), p.patch ?? {})
      }
      case 'timers.removeJob':
        return this.opts.timers?.removeJob(asString(p.id)) ?? false
      case 'timers.runNow':
        return this.opts.timers?.runNow(asString(p.id)) ?? null
      case 'timers.listRuns':
        return this.opts.timers?.listRuns(asString(p.jobId) || undefined) ?? []
      case 'timers.listSessions':
        return this.opts.timers?.listSessions() ?? []
      case 'connectors.catalog':
        return this.opts.connectors?.catalog() ?? []
      case 'connectors.probe':
        return this.opts.connectors?.probe(asString(p.cwd)) ?? []
      case 'connectors.act': {
        if (!this.opts.connectors) return { ok: false, error: 'unavailable' }
        return this.opts.connectors.act(p.request ?? p)
      }
      case 'connectors.authStatus':
        return (
          this.opts.connectors?.authStatus() ?? {
            rows: [],
            login: { connector: null, status: 'idle' }
          }
        )
      case 'connectors.beginLogin': {
        if (!this.opts.connectors) {
          return {
            rows: [],
            login: { connector: null, status: 'error', message: 'unavailable' }
          }
        }
        return this.opts.connectors.beginLogin(asString(p.id) || asString(p.connector))
      }
      case 'connectors.cancelLogin': {
        if (!this.opts.connectors) {
          return { rows: [], login: { connector: null, status: 'idle' } }
        }
        return this.opts.connectors.cancelLogin(asString(p.id) || asString(p.connector) || undefined)
      }
      case 'cloudflare.status': {
        if (!this.opts.connectors) return { ok: false, error: 'unavailable' }
        return this.opts.connectors.cloudflareStatus(asString(p.cwd), p.query)
      }
      case 'supabase.status': {
        if (!this.opts.connectors) return { ok: false, error: 'unavailable' }
        return this.opts.connectors.supabaseStatus(asString(p.cwd), p.query)
      }
      case 'vercel.status': {
        if (!this.opts.connectors) return { ok: false, error: 'unavailable' }
        return this.opts.connectors.vercelStatus(asString(p.cwd), p.query)
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
      case 'logs.query':
        return { records: this.opts.logs?.query(sanitizeLogQuery(p)) ?? [] }
      case 'logs.stats':
        return this.opts.logs?.stats() ?? EMPTY_LOG_STATS
      case 'logs.clear': {
        const scope: AppLogClearScope =
          p.scope === 'all' || isLogRetentionClass(p.scope) ? p.scope : 'all'
        return { removed: this.opts.logs?.clear(scope) ?? 0 }
      }
      case 'logs.export':
        return { text: this.opts.logs?.exportText(sanitizeLogQuery(p)) ?? '' }
      case 'logs.record': {
        if (!this.opts.logs || p.channel !== 'user') return { ok: false }
        const input: AppLogInput = {
          channel: 'user',
          event: asString(p.event),
          message: asString(p.message),
          conversationId: typeof p.conversationId === 'string' ? p.conversationId : undefined,
          data: p.data && typeof p.data === 'object' && !Array.isArray(p.data)
            ? (p.data as Record<string, unknown>)
            : undefined,
          level: p.level === 'debug' ? 'debug' : 'info'
        }
        return { ok: Boolean(this.opts.logs.append(input)) }
      }
      case 'logs.subscribe': {
        const stream = `log-${randomUUID()}`
        const off = this.opts.logs?.subscribe((record) => {
          writeLine(socket, { type: 'stream', stream, event: 'append', data: record })
        })
        live.watches.set(stream, { close: () => off?.() })
        return { stream }
      }
      case 'logs.unsubscribe': {
        const stream = asString(p.stream)
        live.watches.get(stream)?.close()
        live.watches.delete(stream)
        return { ok: true }
      }
      default:
        throw new Error(`unknown method: ${method}`)
    }
  }

  private spawnProcess(
    p: Record<string, unknown>,
    socket: Socket
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
    this.processes.set(stream, { child, socket })
    const push = (event: string, data?: unknown): void => {
      const dest = this.processes.get(stream)?.socket
      if (dest && !dest.destroyed) {
        writeLine(dest, { type: 'stream', stream, event, data })
      }
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
      this.processes.delete(stream)
    })
    return { stream, pid: child.pid }
  }

  private spawnPty(
    p: Record<string, unknown>,
    socket: Socket
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
    this.ptys.set(stream, { proc, socket })
    proc.onData((data) => {
      const dest = this.ptys.get(stream)?.socket
      if (dest && !dest.destroyed) {
        writeLine(dest, { type: 'stream', stream, event: 'pty-data', data: { text: data } })
      }
    })
    proc.onExit((e) => {
      const dest = this.ptys.get(stream)?.socket
      if (dest && !dest.destroyed) {
        writeLine(dest, {
          type: 'stream',
          stream,
          event: 'pty-exit',
          data: { exitCode: e.exitCode, signal: e.signal }
        })
      }
      try {
        proc.kill()
      } catch {
        /* ConPTY/worker teardown is idempotent */
      }
      this.ptys.delete(stream)
    })
    return { stream, pid: proc.pid }
  }
}
