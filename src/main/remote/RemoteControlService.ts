/**
 * Remote control over tailcat (settings-notifications.rpml 远程控制).
 *
 * Owns the tailcatbridge sidecar (Tailscale data plane listener with a
 * persistent identity) and a localhost TCP server speaking the JSON-lines
 * protocol from `@shared/remoteControl`. The sidecar is a dumb encrypted
 * pipe; every protocol decision lives here where it is observable and
 * testable.
 *
 * Scope (确认过的产品边界): foreground-realtime only — notification fan-out
 * and remote message sending while the phone app is open. No push relay.
 */
import { app } from 'electron'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveSidecarBinary } from './sidecarBinary.ts'
import type { Readable, Writable } from 'node:stream'
import {
  REMOTE_MAX_LINE_BYTES,
  REMOTE_PROTO_VERSION,
  drainJsonLines,
  encodeLine,
  encodePairing,
  parseClientMessage,
  type RemoteConfigure,
  type RemoteControlState,
  type RemoteControlStatus,
  type RemoteControlsEvent,
  type RemoteDirsEvent,
  type RemoteHostEvent,
  type RemoteNotification,
  type RemoteNotifyKind,
  type RemoteSendImage,
  type RemoteServerMessage,
  type RemoteSession,
  type RemoteThreadBlock,
  type RemoteThreadEvent,
  type RemoteTurnEvent
} from '@shared/remoteControl'
import {
  applyLiveDelta,
  compactLiveBlocks,
  draftFromLiveBlocks
} from '@shared/remoteLiveLog'

export type RemoteSendResult = 'ok' | 'not-found' | 'archived'
export type RemoteConfigureResult = 'ok' | 'not-found' | 'archived' | 'locked'
export type RemoteWorkspaceResult = 'ok' | 'not-found' | 'archived' | 'forbidden'

type Deps = {
  enabled: () => boolean
  appVersion: string
  listSessions: () => RemoteSession[]
  listThread: (conversationId: string) => RemoteThreadEvent | null
  listControls: (conversationId: string) => RemoteControlsEvent | null
  listHost: () => RemoteHostEvent
  configure: (message: RemoteConfigure) => RemoteConfigureResult
  sendMessage: (
    conversationId: string,
    text: string,
    attachments?: string[]
  ) => RemoteSendResult
  /** Same defaults as desktop New Session (workdir / host / model). */
  createSession: () => RemoteSession
  cancel: (conversationId: string) => RemoteSendResult
  reply: (conversationId: string, toolCallId: string, answer: string) => boolean
  rename: (conversationId: string, title: string) => RemoteSendResult
  archive: (conversationId: string) => RemoteSendResult
  browse: (conversationId: string, path?: string) => RemoteDirsEvent | 'not-found' | 'forbidden'
  setWorkspace: (conversationId: string, path: string | null) => RemoteWorkspaceResult
  onStatusChange: (status: RemoteControlStatus) => void
  /** Tailcat hello with `role: 'daemon'` — hand the socket to the host RPC. */
  onDaemonSocket?: (socket: Socket, leftover: string) => void
}

type RemoteClient = {
  socket: Socket
  buffer: string
  authed: boolean
  device: string
  since: number
}

const RESTART_DELAY_MS = 5_000
const SESSIONS_DEBOUNCE_MS = 300
const RECENT_ALERT_CAP = 50
const DRAFT_FLUSH_MS = 180

/** Compare secrets without length leaks: hash both, then constant-time equal. */
function secretsMatch(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest()
  const hb = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(ha, hb)
}

export class RemoteControlService {
  private server: Server | null = null
  private sidecar: ChildProcessByStdio<Writable, Readable, Readable> | null = null
  private clients = new Set<RemoteClient>()
  private token: string | null = null
  private state: RemoteControlState = 'disabled'
  private lastError: string | null = null
  private stderrTail: string[] = []
  private restartTimer: NodeJS.Timeout | null = null
  private sessionsTimer: NodeJS.Timeout | null = null
  /** Generation counter so a stale sidecar exit never clobbers a restart. */
  private generation = 0
  /** Live alerts kept so a phone that connects later still sees them. */
  private recentAlerts: RemoteNotification[] = []
  private drafts = new Map<string, { text: string; thinking: string }>()
  private draftTimers = new Map<string, NodeJS.Timeout>()
  private liveSlots = new Map<string, Map<number, RemoteThreadBlock>>()
  private liveAwaiting = new Map<string, Extract<RemoteThreadBlock, { kind: 'awaiting' }>>()
  private knownDevices: { device: string; lastSeen: number }[] = []
  private devicesLoaded = false

  constructor(private deps: Deps) {}

  private get stateDir(): string {
    return join(app.getPath('userData'), 'remote-control')
  }
  private get keyFile(): string {
    return join(this.stateDir, 'tailcat-key.json')
  }
  private get secretFile(): string {
    return join(this.stateDir, 'secret.json')
  }
  private get devicesFile(): string {
    return join(this.stateDir, 'known-devices.json')
  }

  /** Start or stop to match settings. Safe to call repeatedly. */
  applySettings(): void {
    if (this.deps.enabled()) {
      if (!this.server && !this.restartTimer) this.start()
    } else {
      this.stop('disabled')
    }
  }

  status(): RemoteControlStatus {
    const pairing =
      this.state === 'ready' && this.token
        ? encodePairing({
            v: 1,
            token: this.token,
            secret: this.loadOrCreateSecret(),
            host: hostname()
          })
        : null
    const online = new Set(
      [...this.clients].filter((c) => c.authed).map((c) => c.device)
    )
    return {
      state: this.state,
      pairing,
      clients: [...this.clients]
        .filter((c) => c.authed)
        .map((c) => ({ device: c.device, since: c.since })),
      devices: this.loadKnownDevices().map((row) => ({
        device: row.device,
        lastSeen: row.lastSeen,
        connected: online.has(row.device)
      })),
      error: this.state === 'error' ? this.lastError : null
    }
  }

  /** Same secret the daemon protocol uses — one pairing channel. */
  pairingSecret(): string {
    return this.loadOrCreateSecret()
  }

  tunnelToken(): string | null {
    return this.token
  }

  /** New pairing secret; every connected phone must re-scan. */
  regenerateSecret(): void {
    this.persistSecret(randomBytes(24).toString('base64url'))
    this.persistKnownDevices([])
    this.dropClients()
    this.publishStatus()
  }

  /** New tailcat identity (token) and secret. Restarts the tunnel. */
  resetIdentity(): void {
    this.stop('disabled')
    try {
      rmSync(this.keyFile, { force: true })
      rmSync(this.secretFile, { force: true })
      rmSync(this.devicesFile, { force: true })
    } catch {
      // Stale identity only risks a dangling QR; continue.
    }
    this.applySettings()
  }

  /** Fan a NotificationCenter alert out to connected phones. */
  notifyRemote(kind: RemoteNotifyKind, conversationId: string, title: string, body: string): void {
    const note: RemoteNotification = {
      type: 'notification',
      kind,
      conversationId,
      title,
      body,
      at: Date.now()
    }
    this.rememberAlert(note)
    this.broadcast(note)
    const thread = this.deps.listThread(conversationId)
    if (thread) this.broadcast(thread)
    this.schedulePushSessions()
  }

  pushControls(controls: RemoteControlsEvent): void {
    this.broadcast(controls)
  }

  pushTurn(event: RemoteTurnEvent): void {
    if (event.phase !== 'running') {
      this.clearLive(event.conversationId)
    }
    this.broadcast(event)
  }

  beginLive(conversationId: string): void {
    this.liveSlots.set(conversationId, new Map())
    this.liveAwaiting.delete(conversationId)
    this.clearDraft(conversationId)
    this.broadcast({ type: 'turn', conversationId, phase: 'running', blocks: [] })
  }

  appendLive(
    conversationId: string,
    index: number,
    kind: 'text' | 'reasoning',
    chunk: string
  ): void {
    if (!chunk) return
    let slots = this.liveSlots.get(conversationId)
    if (!slots) {
      slots = new Map()
      this.liveSlots.set(conversationId, slots)
    }
    applyLiveDelta(slots, index, kind, chunk)
    const cur = this.drafts.get(conversationId) ?? { text: '', thinking: '' }
    if (kind === 'reasoning') cur.thinking += chunk
    else cur.text += chunk
    this.drafts.set(conversationId, cur)
    this.scheduleLiveFlush(conversationId)
  }

  setLiveBlock(conversationId: string, index: number, block: RemoteThreadBlock): void {
    let slots = this.liveSlots.get(conversationId)
    if (!slots) {
      slots = new Map()
      this.liveSlots.set(conversationId, slots)
    }
    slots.set(index, block)
    if (block.kind === 'awaiting') this.liveAwaiting.set(conversationId, block)
    else if (block.kind === 'tool' && this.liveAwaiting.get(conversationId)?.id === block.id) {
      this.liveAwaiting.delete(conversationId)
    }
    this.scheduleLiveFlush(conversationId)
  }

  appendDraft(conversationId: string, chunk: string, channel: 'text' | 'reasoning' = 'text'): void {
    this.appendLive(conversationId, channel === 'reasoning' ? 0 : 1, channel, chunk)
  }

  finishTurn(conversationId: string, phase: RemoteTurnEvent['phase'], error?: string): void {
    this.clearLive(conversationId)
    this.broadcast({
      type: 'turn',
      conversationId,
      phase,
      ...(error ? { error } : {})
    })
    const thread = this.deps.listThread(conversationId)
    if (thread) this.broadcast(thread)
    this.schedulePushSessions()
  }

  private scheduleLiveFlush(conversationId: string): void {
    if (this.draftTimers.has(conversationId)) return
    this.draftTimers.set(
      conversationId,
      setTimeout(() => {
        this.draftTimers.delete(conversationId)
        const slots = this.liveSlots.get(conversationId)
        if (!slots) return
        const blocks = compactLiveBlocks(slots)
        const derived = draftFromLiveBlocks(blocks)
        const awaiting = this.liveAwaiting.get(conversationId)
        this.broadcast({
          type: 'turn',
          conversationId,
          phase: awaiting ? 'awaiting' : 'running',
          ...(blocks.length ? { blocks } : {}),
          ...(derived.text ? { draft: derived.text } : {}),
          ...(derived.thinking ? { thinking: derived.thinking } : {}),
          ...(awaiting ? { awaiting } : {})
        })
      }, DRAFT_FLUSH_MS)
    )
  }

  private clearDraft(conversationId: string): void {
    this.drafts.delete(conversationId)
    const timer = this.draftTimers.get(conversationId)
    if (timer) {
      clearTimeout(timer)
      this.draftTimers.delete(conversationId)
    }
  }

  private clearLive(conversationId: string): void {
    this.clearDraft(conversationId)
    this.liveSlots.delete(conversationId)
    this.liveAwaiting.delete(conversationId)
  }

  /** Debounced session-list push; call whenever tray/session state changes. */
  schedulePushSessions(): void {
    if (this.clients.size === 0) return
    if (this.sessionsTimer) return
    this.sessionsTimer = setTimeout(() => {
      this.sessionsTimer = null
      this.broadcast({ type: 'sessions', sessions: this.deps.listSessions() })
    }, SESSIONS_DEBOUNCE_MS)
  }

  dispose(): void {
    this.stop('disabled')
  }

  // --- lifecycle ---

  private start(): void {
    const binary = resolveSidecarBinary()
    if (!binary) {
      this.setState('no-binary', 'tailcatbridge binary not found')
      return
    }
    this.setState('starting', null)
    const generation = ++this.generation

    const server = createServer((socket) => this.handleConnection(socket))
    server.on('error', (err) => {
      if (generation !== this.generation) return
      this.failAndScheduleRestart(`local server: ${err.message}`)
    })
    server.listen(0, '127.0.0.1', () => {
      if (generation !== this.generation) {
        server.close()
        return
      }
      const address = server.address()
      if (!address || typeof address === 'string') {
        this.failAndScheduleRestart('local server: no address')
        return
      }
      this.spawnSidecar(binary, address.port, generation)
    })
    this.server = server
  }

  private spawnSidecar(binary: string, forwardPort: number, generation: number): void {
    mkdirSync(this.stateDir, { recursive: true })
    let child: ChildProcessByStdio<Writable, Readable, Readable>
    try {
      child = spawn(
        binary,
        ['--key-file', this.keyFile, '--forward', `127.0.0.1:${forwardPort}`],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      )
    } catch (err) {
      this.failAndScheduleRestart(
        `spawn: ${err instanceof Error ? err.message : String(err)}`
      )
      return
    }
    this.sidecar = child
    this.stderrTail = []

    let stdoutBuffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (generation !== this.generation) return
      stdoutBuffer += chunk
      const { values, rest } = drainJsonLines(stdoutBuffer)
      stdoutBuffer = rest
      for (const value of values) {
        const event = value as { event?: string; token?: string } | null
        if (event?.event === 'ready' && typeof event.token === 'string') {
          this.token = event.token
          this.setState('ready', null)
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = [...this.stderrTail, chunk].slice(-20)
    })
    child.on('error', (err) => {
      if (generation !== this.generation) return
      this.failAndScheduleRestart(`sidecar: ${err.message}`)
    })
    child.on('exit', (code) => {
      if (generation !== this.generation) return
      const detail = this.stderrTail.join('').trim().split('\n').slice(-3).join('\n')
      this.failAndScheduleRestart(
        `sidecar exited (${code ?? 'signal'})${detail ? `: ${detail}` : ''}`
      )
    })
  }

  private failAndScheduleRestart(message: string): void {
    console.error('[remote-control]', message)
    this.teardown()
    this.setState('error', message)
    if (!this.deps.enabled()) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.deps.enabled()) this.start()
    }, RESTART_DELAY_MS)
  }

  private stop(state: RemoteControlState): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    if (!this.server && !this.sidecar && this.state === state) return
    this.teardown()
    this.setState(state, null)
  }

  private teardown(): void {
    this.generation++
    this.dropClients()
    if (this.sessionsTimer) {
      clearTimeout(this.sessionsTimer)
      this.sessionsTimer = null
    }
    // Closing stdin is the sidecar's shutdown signal; kill is the backstop.
    if (this.sidecar) {
      const child = this.sidecar
      this.sidecar = null
      try {
        child.stdin.end()
      } catch {
        // already gone
      }
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 3_000)
      child.once('exit', () => clearTimeout(killTimer))
    }
    this.server?.close()
    this.server = null
    this.token = null
    for (const timer of this.draftTimers.values()) clearTimeout(timer)
    this.draftTimers.clear()
    this.drafts.clear()
  }

  private dropClients(): void {
    for (const client of this.clients) client.socket.destroy()
    this.clients.clear()
  }

  private setState(state: RemoteControlState, error: string | null): void {
    this.state = state
    this.lastError = error
    this.publishStatus()
  }

  private publishStatus(): void {
    this.deps.onStatusChange(this.status())
  }

  // --- protocol ---

  private handleConnection(socket: Socket): void {
    const client: RemoteClient = {
      socket,
      buffer: '',
      authed: false,
      device: 'unknown',
      since: Date.now()
    }
    this.clients.add(client)
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      client.buffer += chunk
      if (client.buffer.length > REMOTE_MAX_LINE_BYTES) {
        socket.destroy()
        return
      }
      const { values, rest } = drainJsonLines(client.buffer)
      client.buffer = rest
      for (const value of values) {
        if (!this.handleFrame(client, value)) {
          socket.destroy()
          return
        }
      }
    })
    const forget = (): void => {
      const wasAuthed = client.authed
      this.clients.delete(client)
      if (wasAuthed) this.publishStatus()
    }
    socket.on('close', forget)
    socket.on('error', forget)
  }

  /** @returns false to drop the connection. */
  private handleFrame(client: RemoteClient, value: unknown): boolean {
    const message = parseClientMessage(value)
    if (!message) {
      // After auth, ignore unknown frames — never drop the tunnel, and
      // don't send `unrecognized frame` (the phone treated that as 发送失败).
      if (client.authed) return true
      this.send(client, { type: 'error', code: 'bad-request', message: 'unrecognized frame' })
      return false
    }

    if (!client.authed) {
      if (message.type !== 'hello' || !secretsMatch(message.auth, this.loadOrCreateSecret())) {
        this.send(client, { type: 'error', code: 'auth', message: 'pairing rejected' })
        return false
      }
      if (message.role === 'daemon') {
        if (!this.deps.onDaemonSocket) {
          this.send(client, { type: 'error', code: 'bad-request', message: 'daemon not available' })
          return false
        }
        this.clients.delete(client)
        client.socket.removeAllListeners('data')
        this.deps.onDaemonSocket(client.socket, client.buffer)
        return true
      }
      client.authed = true
      client.device = (message.device ?? '').trim().slice(0, 64) || 'unknown'
      this.rememberDevice(client.device)
      this.send(client, {
        type: 'welcome',
        proto: REMOTE_PROTO_VERSION,
        app: 'VAV',
        version: this.deps.appVersion
      })
      // Sessions first: the phone can paint the list before host metadata
      // and alert replay occupy the single tunnel.
      this.send(client, { type: 'sessions', sessions: this.deps.listSessions() })
      this.send(client, this.deps.listHost())
      this.replayAlerts(client)
      this.publishStatus()
      return true
    }

    switch (message.type) {
      case 'hello':
        // Duplicate hello after auth — harmless, ignore.
        return true
      case 'ping':
        this.send(client, { type: 'pong' })
        return true
      case 'sessions':
        this.send(client, { type: 'sessions', sessions: this.deps.listSessions() })
        return true
      case 'create': {
        try {
          const session = this.deps.createSession()
          this.send(client, { type: 'created', session })
          this.send(client, { type: 'sessions', sessions: this.deps.listSessions() })
          this.schedulePushSessions()
        } catch (err) {
          this.send(client, {
            type: 'error',
            code: 'bad-request',
            message: err instanceof Error ? err.message : 'create failed'
          })
        }
        return true
      }
      case 'thread': {
        const thread = this.deps.listThread(message.conversationId)
        // Always reply so an empty or missing session unblocks the phone
        // instead of hanging on "loading". Missing → empty log, not an error.
        this.send(
          client,
          thread ?? { type: 'thread', conversationId: message.conversationId, messages: [] }
        )
        const controls = this.deps.listControls(message.conversationId)
        if (controls) this.send(client, controls)
        return true
      }
      case 'controls': {
        const controls = this.deps.listControls(message.conversationId)
        if (controls) this.send(client, controls)
        return true
      }
      case 'configure': {
        const result = this.deps.configure(message)
        if (result === 'ok') {
          const controls = this.deps.listControls(message.conversationId)
          if (controls) this.send(client, controls)
        } else {
          this.send(client, {
            type: 'error',
            code: result,
            message:
              result === 'archived'
                ? 'conversation is archived'
                : result === 'locked'
                  ? 'agent is locked after the first turn'
                  : 'no such conversation',
            conversationId: message.conversationId
          })
        }
        return true
      }
      case 'cancel': {
        const result = this.deps.cancel(message.conversationId)
        if (result !== 'ok') {
          this.send(client, {
            type: 'error',
            code: result,
            message: result === 'archived' ? 'conversation is archived' : 'no such conversation',
            conversationId: message.conversationId
          })
        }
        return true
      }
      case 'reply': {
        const ok = this.deps.reply(message.conversationId, message.toolCallId, message.answer)
        if (!ok) {
          this.send(client, {
            type: 'error',
            code: 'not-found',
            message: 'nothing is waiting for a reply',
            conversationId: message.conversationId
          })
        }
        return true
      }
      case 'rename': {
        const result = this.deps.rename(message.conversationId, message.title)
        if (result === 'ok') {
          this.send(client, { type: 'sessions', sessions: this.deps.listSessions() })
          this.schedulePushSessions()
        } else {
          this.send(client, {
            type: 'error',
            code: result,
            message: result === 'archived' ? 'conversation is archived' : 'no such conversation',
            conversationId: message.conversationId
          })
        }
        return true
      }
      case 'archive': {
        const result = this.deps.archive(message.conversationId)
        if (result === 'ok') {
          this.send(client, { type: 'sessions', sessions: this.deps.listSessions() })
          this.schedulePushSessions()
        } else {
          this.send(client, {
            type: 'error',
            code: result,
            message: 'no such conversation',
            conversationId: message.conversationId
          })
        }
        return true
      }
      case 'browse': {
        const result = this.deps.browse(message.conversationId, message.path)
        if (result === 'not-found' || result === 'forbidden') {
          this.send(client, {
            type: 'error',
            code: result,
            message: result === 'forbidden' ? 'folder is outside the allowed roots' : 'no such conversation',
            conversationId: message.conversationId
          })
        } else {
          this.send(client, result)
        }
        return true
      }
      case 'workspace': {
        const result = this.deps.setWorkspace(
          message.conversationId,
          message.temp ? null : (message.path ?? null)
        )
        if (result === 'ok') {
          const controls = this.deps.listControls(message.conversationId)
          if (controls) this.send(client, controls)
          this.send(client, { type: 'sessions', sessions: this.deps.listSessions() })
          this.schedulePushSessions()
        } else {
          this.send(client, {
            type: 'error',
            code: result,
            message:
              result === 'forbidden'
                ? 'folder is outside the allowed roots'
                : result === 'archived'
                  ? 'conversation is archived'
                  : 'no such conversation',
            conversationId: message.conversationId
          })
        }
        return true
      }
      case 'send': {
        const attachments = writeRemoteInboxImages(message.images)
        const text = message.text
        if (!attachments.length && !text.trim()) {
          this.send(client, {
            type: 'error',
            code: 'bad-request',
            message: 'empty send',
            conversationId: message.conversationId
          })
          return true
        }
        const result = this.deps.sendMessage(message.conversationId, text, attachments)
        if (result === 'ok') {
          this.send(client, { type: 'sent', conversationId: message.conversationId })
          const thread = this.deps.listThread(message.conversationId)
          if (thread) this.send(client, thread)
        } else {
          this.send(client, {
            type: 'error',
            code: result,
            message: result === 'archived' ? 'conversation is archived' : 'no such conversation',
            conversationId: message.conversationId
          })
        }
        return true
      }
    }
    return true
  }

  private send(client: RemoteClient, message: RemoteServerMessage): void {
    if (client.socket.destroyed) return
    client.socket.write(encodeLine(message))
  }

  private broadcast(message: RemoteServerMessage): void {
    const line = encodeLine(message)
    for (const client of this.clients) {
      if (client.authed && !client.socket.destroyed) client.socket.write(line)
    }
  }

  private rememberAlert(note: RemoteNotification): void {
    this.recentAlerts.push(note)
    if (this.recentAlerts.length > RECENT_ALERT_CAP) {
      this.recentAlerts.splice(0, this.recentAlerts.length - RECENT_ALERT_CAP)
    }
  }

  /** Handshake: replay live alerts only. Done-row synthesis bloated the first paint. */
  private replayAlerts(client: RemoteClient): void {
    for (const note of this.recentAlerts) {
      this.send(client, note)
    }
  }

  // --- pairing secret ---

  private cachedSecret: string | null = null

  private loadOrCreateSecret(): string {
    if (this.cachedSecret) return this.cachedSecret
    try {
      if (existsSync(this.secretFile)) {
        const raw = JSON.parse(readFileSync(this.secretFile, 'utf8')) as { secret?: unknown }
        if (typeof raw.secret === 'string' && raw.secret.length >= 16) {
          this.cachedSecret = raw.secret
          return raw.secret
        }
      }
    } catch {
      // Unreadable → rotate below.
    }
    const secret = randomBytes(24).toString('base64url')
    this.persistSecret(secret)
    return secret
  }

  private persistSecret(secret: string): void {
    this.cachedSecret = secret
    mkdirSync(dirname(this.secretFile), { recursive: true })
    writeFileSync(this.secretFile, JSON.stringify({ secret }), { mode: 0o600 })
  }

  private loadKnownDevices(): { device: string; lastSeen: number }[] {
    if (this.devicesLoaded) return this.knownDevices
    this.devicesLoaded = true
    try {
      if (existsSync(this.devicesFile)) {
        const raw = JSON.parse(readFileSync(this.devicesFile, 'utf8')) as {
          devices?: { device?: unknown; lastSeen?: unknown }[]
        }
        this.knownDevices = (raw.devices ?? [])
          .filter(
            (row): row is { device: string; lastSeen: number } =>
              typeof row.device === 'string' &&
              row.device.trim().length > 0 &&
              typeof row.lastSeen === 'number'
          )
          .slice(0, 16)
      }
    } catch {
      this.knownDevices = []
    }
    return this.knownDevices
  }

  private rememberDevice(device: string): void {
    const name = device.trim().slice(0, 64)
    if (!name) return
    const rows = this.loadKnownDevices()
    const now = Date.now()
    const existing = rows.findIndex((row) => row.device === name)
    if (existing >= 0) rows[existing] = { device: name, lastSeen: now }
    else rows.unshift({ device: name, lastSeen: now })
    this.persistKnownDevices(rows.slice(0, 16))
  }

  private persistKnownDevices(rows: { device: string; lastSeen: number }[]): void {
    this.devicesLoaded = true
    this.knownDevices = rows
    try {
      mkdirSync(dirname(this.devicesFile), { recursive: true })
      writeFileSync(this.devicesFile, JSON.stringify({ devices: rows }), { mode: 0o600 })
    } catch {
      // Roster is convenience only.
    }
  }
}

function writeRemoteInboxImages(images: RemoteSendImage[] | undefined): string[] {
  if (!images?.length) return []
  const dir = join(app.getPath('temp'), 'vav-remote-inbox')
  mkdirSync(dir, { recursive: true })
  const paths: string[] = []
  for (const image of images) {
    let buffer: Buffer
    try {
      buffer = Buffer.from(image.data, 'base64')
    } catch {
      continue
    }
    if (!buffer.length) continue
    const ext =
      image.mime === 'image/png' ? 'png' : image.mime === 'image/webp' ? 'webp' : 'jpg'
    const name = (image.name.replace(/[^\w.-]+/g, '_') || 'photo').slice(0, 40)
    const path = join(dir, `${Date.now()}-${paths.length}-${name}.${ext}`)
    writeFileSync(path, buffer)
    paths.push(path)
  }
  return paths
}
