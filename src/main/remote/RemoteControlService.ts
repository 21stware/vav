/**
 * Remote control transport (sidecar + pairing files).
 *
 * Protocol decisions live in `RemoteControlHub` — Electron-free, shared by
 * the tailcat localhost pipe and the LAN daemon listen port. This class
 * only owns identity, the sidecar, and persistence.
 *
 * Scope: foreground-realtime session plane. Workspace RPC is the daemon.
 */
import { app } from 'electron'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveSidecarBinary } from './sidecarBinary.ts'
import type { Readable, Writable } from 'node:stream'
import {
  drainJsonLines,
  encodePairing,
  type RemoteConfigure,
  type RemoteControlState,
  type RemoteControlStatus,
  type RemoteControlsEvent,
  type RemoteDirsEvent,
  type RemoteHello,
  type RemoteHostEvent,
  type RemoteNotifyKind,
  type RemoteSendImage,
  type RemoteSession,
  type RemoteThreadBlock,
  type RemoteThreadEvent,
  type RemoteTurnEvent
} from '@shared/remoteControl'
import {
  RemoteControlHub,
  type RemoteConfigureResult,
  type RemoteSendResult,
  type RemoteWorkspaceResult
} from './RemoteControlHub.ts'

export type { RemoteConfigureResult, RemoteSendResult, RemoteWorkspaceResult }

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

const RESTART_DELAY_MS = 5_000

export class RemoteControlService {
  private server: Server | null = null
  private sidecar: ChildProcessByStdio<Writable, Readable, Readable> | null = null
  private token: string | null = null
  private state: RemoteControlState = 'disabled'
  private lastError: string | null = null
  private stderrTail: string[] = []
  private restartTimer: NodeJS.Timeout | null = null
  /** Generation counter so a stale sidecar exit never clobbers a restart. */
  private generation = 0
  private knownDevices: { device: string; lastSeen: number }[] = []
  private devicesLoaded = false
  readonly hub: RemoteControlHub

  constructor(private deps: Deps) {
    this.hub = new RemoteControlHub({
      appVersion: deps.appVersion,
      listSessions: () => deps.listSessions(),
      listThread: (id) => deps.listThread(id),
      listControls: (id) => deps.listControls(id),
      listHost: () => deps.listHost(),
      configure: (message) => deps.configure(message),
      sendMessage: (id, text, attachments) => deps.sendMessage(id, text, attachments),
      createSession: () => deps.createSession(),
      cancel: (id) => deps.cancel(id),
      reply: (id, toolCallId, answer) => deps.reply(id, toolCallId, answer),
      rename: (id, title) => deps.rename(id, title),
      archive: (id) => deps.archive(id),
      browse: (id, path) => deps.browse(id, path),
      setWorkspace: (id, path) => deps.setWorkspace(id, path),
      secret: () => this.loadOrCreateSecret(),
      materializeImages: writeRemoteInboxImages,
      onDaemonHello: (socket, leftover) => deps.onDaemonSocket?.(socket, leftover),
      onClientsChanged: () => {
        for (const client of this.hub.authedClients()) this.rememberDevice(client.device)
        this.publishStatus()
      }
    })
  }

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
    const clients = this.hub.authedClients()
    const online = new Set(clients.map((c) => c.device))
    return {
      state: this.state,
      pairing,
      clients,
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

  /** LAN multiplex: daemon listen port already authenticated a phone hello. */
  adoptControlSocket(socket: Socket, leftover: string, hello: RemoteHello): void {
    this.hub.adoptAuthed(socket, leftover, hello)
  }

  /** Fan a NotificationCenter alert out to connected phones. */
  notifyRemote(kind: RemoteNotifyKind, conversationId: string, title: string, body: string): void {
    this.hub.notifyRemote(kind, conversationId, title, body)
  }

  pushControls(controls: RemoteControlsEvent): void {
    this.hub.pushControls(controls)
  }

  pushTurn(event: RemoteTurnEvent): void {
    this.hub.pushTurn(event)
  }

  beginLive(conversationId: string): void {
    this.hub.beginLive(conversationId)
  }

  appendLive(
    conversationId: string,
    index: number,
    kind: 'text' | 'reasoning',
    chunk: string
  ): void {
    this.hub.appendLive(conversationId, index, kind, chunk)
  }

  setLiveBlock(conversationId: string, index: number, block: RemoteThreadBlock): void {
    this.hub.setLiveBlock(conversationId, index, block)
  }

  appendDraft(conversationId: string, chunk: string, channel: 'text' | 'reasoning' = 'text'): void {
    this.appendLive(conversationId, channel === 'reasoning' ? 0 : 1, channel, chunk)
  }

  finishTurn(conversationId: string, phase: RemoteTurnEvent['phase'], error?: string): void {
    this.hub.finishTurn(conversationId, phase, error)
  }

  /** Debounced session-list push; call whenever tray/session state changes. */
  schedulePushSessions(): void {
    this.hub.schedulePushSessions()
  }

  dispose(): void {
    this.stop('disabled')
    this.hub.dispose()
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

    const server = createServer((socket) => this.hub.attach(socket))
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
    this.hub.dropClients()
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
  }

  private dropClients(): void {
    this.hub.dropClients()
  }

  private setState(state: RemoteControlState, error: string | null): void {
    this.state = state
    this.lastError = error
    this.publishStatus()
  }

  private publishStatus(): void {
    this.deps.onStatusChange(this.status())
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
