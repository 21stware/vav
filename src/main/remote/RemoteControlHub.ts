/**
 * Session-plane hub — Electron-free.
 *
 * Owns authenticated control clients and the live-turn fanout. The desktop
 * sidecar and the LAN daemon listen port both hand sockets here after a
 * phone-role hello. Workspace RPC never enters this class.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import type { Socket } from 'node:net'
import {
  REMOTE_MAX_LINE_BYTES,
  REMOTE_PROTO_VERSION,
  drainJsonLines,
  encodeLine,
  parseClientMessage,
  type RemoteConfigure,
  type RemoteControlsEvent,
  type RemoteDirsEvent,
  type RemoteCompaction,
  type RemoteHello,
  type RemoteHostEvent,
  type RemoteNotification,
  type RemoteNotifyKind,
  type RemoteSendImage,
  type RemoteServerMessage,
  type RemoteSession,
  type RemoteThreadBlock,
  type RemoteThreadEvent,
  type RemoteTurnEvent,
  type RemoteTurnRecovery
} from '../../shared/remoteControl.ts'
import { applyLiveDelta, compactLiveBlocks, draftFromLiveBlocks } from '../../shared/remoteLiveLog.ts'

export type RemoteSendResult = 'ok' | 'not-found' | 'archived'
export type RemoteConfigureResult = 'ok' | 'not-found' | 'archived' | 'locked'
export type RemoteWorkspaceResult = 'ok' | 'not-found' | 'archived' | 'forbidden'

export type RemoteControlHubDeps = {
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
  createSession: (conversationId?: string) => RemoteSession
  cancel: (conversationId: string) => RemoteSendResult
  reply: (conversationId: string, toolCallId: string, answer: string) => boolean
  rename: (conversationId: string, title: string) => RemoteSendResult
  archive: (conversationId: string) => RemoteSendResult
  pin: (conversationId: string, pinned: boolean) => RemoteSendResult
  favorite: (conversationId: string, favorite: boolean) => RemoteSendResult
  browse: (
    conversationId: string,
    path?: string,
    files?: boolean
  ) => RemoteDirsEvent | 'not-found' | 'forbidden'
  setWorkspace: (conversationId: string, path: string | null) => RemoteWorkspaceResult
  compact?: (
    conversationId: string,
    keepAfterMessageId?: string
  ) => Promise<{ ok: true; compaction: RemoteCompaction } | { ok: false; error: string }>
  clearCompaction?: (
    conversationId: string,
    leafId: string
  ) => { ok: true } | { ok: false; error: string }
  regenerate?: (conversationId: string, messageId: string) => RemoteSendResult
  edit?: (conversationId: string, messageId: string, text: string) => RemoteSendResult
  fork?: (conversationId: string, messageId: string) => RemoteSendResult
  deleteMessage?: (conversationId: string, messageId: string) => RemoteSendResult
  setLeaf?: (conversationId: string, messageId: string, follow?: boolean) => RemoteSendResult
  duplicate?: (conversationId: string) => RemoteSession | null
  continueInNew?: (conversationId: string, messageId: string) => RemoteSession | null
  applyGoal?: (
    conversationId: string,
    action: 'set' | 'pause' | 'resume' | 'clear',
    objective?: string
  ) =>
    | { ok: true; via: 'rpc' }
    | { ok: true; via: 'slash'; text: string }
    | { ok: false; error: string }
  locateWorkspace?: (
    conversationId: string,
    destinationDir: string
  ) => Promise<{ ok: true; workdir: string } | { ok: false; error: string }>
  review?: (
    conversationId: string,
    action: 'active' | 'get' | 'accept-all' | 'reject-all',
    setId?: string
  ) => Promise<
    | { ok: true; set: import('../../shared/remoteControl.ts').RemoteReviewSet | null }
    | { ok: false; error: string }
  >
  secret: () => string
  /** Extra accepted hellos (issued machine grants). Phone secret stays `secret()`. */
  acceptAuth?: (auth: string) => boolean
  materializeImages?: (images: RemoteSendImage[] | undefined) => string[]
  onDaemonHello?: (socket: Socket, leftover: string, hello: RemoteHello) => void
  onClientsChanged?: () => void
}

type HubClient = {
  socket: Socket
  buffer: string
  authed: boolean
  device: string
  since: number
}

const SESSIONS_DEBOUNCE_MS = 300
const RECENT_ALERT_CAP = 50
const DRAFT_FLUSH_MS = 180

function secretsMatch(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest()
  const hb = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(ha, hb)
}

export class RemoteControlHub {
  private clients = new Set<HubClient>()
  private sessionsTimer: NodeJS.Timeout | null = null
  private recentAlerts: RemoteNotification[] = []
  private drafts = new Map<string, { text: string; thinking: string }>()
  private draftTimers = new Map<string, NodeJS.Timeout>()
  private liveSlots = new Map<string, Map<number, RemoteThreadBlock>>()
  private liveAwaiting = new Map<string, Extract<RemoteThreadBlock, { kind: 'awaiting' }>>()
  private liveRecovery = new Map<string, RemoteTurnRecovery>()

  private deps: RemoteControlHubDeps

  constructor(deps: RemoteControlHubDeps) {
    this.deps = deps
  }

  attach(socket: Socket, leftover = ''): void {
    const client: HubClient = {
      socket,
      buffer: leftover,
      authed: false,
      device: 'unknown',
      since: Date.now()
    }
    this.clients.add(client)
    socket.setEncoding('utf8')
    this.drain(client)
    socket.on('data', (chunk: string) => {
      client.buffer += chunk
      if (client.buffer.length > REMOTE_MAX_LINE_BYTES) {
        socket.destroy()
        return
      }
      this.drain(client)
    })
    const forget = (): void => {
      const wasAuthed = client.authed
      this.clients.delete(client)
      if (wasAuthed) this.deps.onClientsChanged?.()
    }
    socket.on('close', forget)
    socket.on('error', forget)
  }

  /** Hello already checked (LAN multiplex). Send the control welcome. */
  adoptAuthed(socket: Socket, leftover: string, hello: RemoteHello): void {
    const client: HubClient = {
      socket,
      buffer: leftover,
      authed: true,
      device: (hello.device ?? '').trim().slice(0, 64) || 'unknown',
      since: Date.now()
    }
    this.clients.add(client)
    socket.setEncoding('utf8')
    this.welcome(client)
    this.drain(client)
    socket.on('data', (chunk: string) => {
      client.buffer += chunk
      if (client.buffer.length > REMOTE_MAX_LINE_BYTES) {
        socket.destroy()
        return
      }
      this.drain(client)
    })
    const forget = (): void => {
      this.clients.delete(client)
      this.deps.onClientsChanged?.()
    }
    socket.on('close', forget)
    socket.on('error', forget)
    this.deps.onClientsChanged?.()
  }

  private helloAuthOk(auth: string): boolean {
    if (secretsMatch(auth, this.deps.secret())) return true
    return this.deps.acceptAuth?.(auth) === true
  }

  authedClients(): { device: string; since: number }[] {
    return [...this.clients].filter((c) => c.authed).map((c) => ({ device: c.device, since: c.since }))
  }

  notifyRemote(kind: RemoteNotifyKind, conversationId: string, title: string, body: string): void {
    const note: RemoteNotification = {
      type: 'notification',
      kind,
      conversationId,
      title,
      body,
      at: Date.now()
    }
    this.recentAlerts.push(note)
    if (this.recentAlerts.length > RECENT_ALERT_CAP) {
      this.recentAlerts.splice(0, this.recentAlerts.length - RECENT_ALERT_CAP)
    }
    this.broadcast(note)
    const thread = this.deps.listThread(conversationId)
    if (thread) this.broadcast(thread)
    this.schedulePushSessions()
  }

  pushControls(controls: RemoteControlsEvent): void {
    this.broadcast(controls)
  }

  pushTurn(event: RemoteTurnEvent): void {
    if (event.phase !== 'running') this.clearLive(event.conversationId)
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
    chunk: string,
    replace = false
  ): void {
    if (!chunk && !replace) return
    let slots = this.liveSlots.get(conversationId)
    if (!slots) {
      slots = new Map()
      this.liveSlots.set(conversationId, slots)
    }
    applyLiveDelta(slots, index, kind, chunk, replace)
    const derived = draftFromLiveBlocks(compactLiveBlocks(slots))
    this.drafts.set(conversationId, derived)
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

  setLiveRecovery(conversationId: string, recovery: RemoteTurnRecovery): void {
    this.liveRecovery.set(conversationId, recovery)
    this.scheduleLiveFlush(conversationId)
  }

  flushThread(conversationId: string): void {
    const thread = this.deps.listThread(conversationId)
    if (thread) this.broadcast(thread)
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

  schedulePushSessions(): void {
    if (this.clients.size === 0) return
    if (this.sessionsTimer) return
    this.sessionsTimer = setTimeout(() => {
      this.sessionsTimer = null
      this.broadcast({ type: 'sessions', sessions: this.deps.listSessions() })
    }, SESSIONS_DEBOUNCE_MS)
  }

  dropClients(): void {
    for (const client of this.clients) client.socket.destroy()
    this.clients.clear()
  }

  dispose(): void {
    if (this.sessionsTimer) {
      clearTimeout(this.sessionsTimer)
      this.sessionsTimer = null
    }
    for (const timer of this.draftTimers.values()) clearTimeout(timer)
    this.draftTimers.clear()
    this.drafts.clear()
    this.dropClients()
  }

  private drain(client: HubClient): void {
    const { values, rest } = drainJsonLines(client.buffer)
    client.buffer = rest
    for (const value of values) {
      if (!this.handleFrame(client, value)) {
        client.socket.destroy()
        return
      }
    }
  }

  private welcome(client: HubClient): void {
    this.send(client, {
      type: 'welcome',
      proto: REMOTE_PROTO_VERSION,
      app: 'VAV',
      version: this.deps.appVersion
    })
    this.send(client, { type: 'sessions', sessions: this.deps.listSessions() })
    this.send(client, this.deps.listHost())
    for (const note of this.recentAlerts) this.send(client, note)
  }

  private handleFrame(client: HubClient, value: unknown): boolean {
    const message = parseClientMessage(value)
    if (!message) {
      if (client.authed) return true
      this.send(client, { type: 'error', code: 'bad-request', message: 'unrecognized frame' })
      return false
    }

    if (!client.authed) {
      if (message.type !== 'hello' || !this.helloAuthOk(message.auth)) {
        this.send(client, { type: 'error', code: 'auth', message: 'pairing rejected' })
        return false
      }
      if (message.role === 'daemon') {
        if (!this.deps.onDaemonHello) {
          this.send(client, { type: 'error', code: 'bad-request', message: 'daemon not available' })
          return false
        }
        this.clients.delete(client)
        client.socket.removeAllListeners('data')
        this.deps.onDaemonHello(client.socket, client.buffer, message)
        return true
      }
      client.authed = true
      client.device = (message.device ?? '').trim().slice(0, 64) || 'unknown'
      this.welcome(client)
      this.deps.onClientsChanged?.()
      return true
    }

    switch (message.type) {
      case 'hello':
        return true
      case 'ping':
        this.send(client, { type: 'pong' })
        return true
      case 'sessions':
        this.send(client, { type: 'sessions', sessions: this.deps.listSessions() })
        return true
      case 'create': {
        try {
          const session = this.deps.createSession(message.conversationId)
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
      case 'pin': {
        const result = this.deps.pin(message.conversationId, message.pinned)
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
      case 'favorite': {
        const result = this.deps.favorite(message.conversationId, message.favorite)
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
      case 'browse': {
        const result = this.deps.browse(message.conversationId, message.path, message.files)
        if (result === 'not-found' || result === 'forbidden') {
          this.send(client, {
            type: 'error',
            code: result,
            message:
              result === 'forbidden' ? 'folder is outside the allowed roots' : 'no such conversation',
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
      case 'compact': {
        const id = message.conversationId
        if (!this.deps.compact) {
          this.send(client, { type: 'compacted', conversationId: id, ok: false, error: 'unavailable' })
          return true
        }
        void this.deps.compact(id, message.keepAfterMessageId).then((result) => {
          if (result.ok) {
            this.send(client, { type: 'compacted', conversationId: id, ok: true, compaction: result.compaction })
            const thread = this.deps.listThread(id)
            if (thread) this.send(client, thread)
          } else {
            this.send(client, { type: 'compacted', conversationId: id, ok: false, error: result.error })
          }
        })
        return true
      }
      case 'clear-compaction': {
        const id = message.conversationId
        const result = this.deps.clearCompaction?.(id, message.leafId) ?? {
          ok: false as const,
          error: 'unavailable'
        }
        if (result.ok) {
          this.send(client, { type: 'compacted', conversationId: id, ok: true })
          const thread = this.deps.listThread(id)
          if (thread) this.send(client, thread)
        } else {
          this.send(client, { type: 'compacted', conversationId: id, ok: false, error: result.error })
        }
        return true
      }
      case 'regenerate': {
        this.ackMutation(
          client,
          message.conversationId,
          this.deps.regenerate?.(message.conversationId, message.messageId) ?? 'not-found',
          false
        )
        return true
      }
      case 'edit': {
        this.ackMutation(
          client,
          message.conversationId,
          this.deps.edit?.(message.conversationId, message.messageId, message.text) ?? 'not-found',
          false
        )
        return true
      }
      case 'fork': {
        this.ackMutation(
          client,
          message.conversationId,
          this.deps.fork?.(message.conversationId, message.messageId) ?? 'not-found',
          true
        )
        return true
      }
      case 'delete-message': {
        this.ackMutation(
          client,
          message.conversationId,
          this.deps.deleteMessage?.(message.conversationId, message.messageId) ?? 'not-found',
          true
        )
        return true
      }
      case 'leaf': {
        this.ackMutation(
          client,
          message.conversationId,
          this.deps.setLeaf?.(message.conversationId, message.messageId, message.follow === true) ??
            'not-found',
          true
        )
        return true
      }
      case 'duplicate': {
        const session = this.deps.duplicate?.(message.conversationId) ?? null
        if (session) {
          this.send(client, { type: 'created', session })
          this.send(client, { type: 'sessions', sessions: this.deps.listSessions() })
        } else {
          this.send(client, {
            type: 'error',
            code: 'not-found',
            message: 'no such conversation',
            conversationId: message.conversationId
          })
        }
        return true
      }
      case 'continue': {
        const session = this.deps.continueInNew?.(message.conversationId, message.messageId) ?? null
        if (session) {
          this.send(client, { type: 'created', session })
          this.send(client, { type: 'sessions', sessions: this.deps.listSessions() })
        } else {
          this.send(client, {
            type: 'error',
            code: 'not-found',
            message: 'no such conversation',
            conversationId: message.conversationId
          })
        }
        return true
      }
      case 'goal': {
        const result = this.deps.applyGoal?.(
          message.conversationId,
          message.action,
          message.objective
        ) ?? { ok: false as const, error: 'unavailable' }
        if (result.ok && result.via === 'slash') {
          this.schedulePushSessions()
          this.send(client, {
            type: 'goaled',
            conversationId: message.conversationId,
            ok: true,
            via: 'slash',
            text: result.text
          })
        } else if (result.ok) {
          this.schedulePushSessions()
          this.send(client, {
            type: 'goaled',
            conversationId: message.conversationId,
            ok: true,
            via: 'rpc'
          })
        } else {
          this.send(client, {
            type: 'goaled',
            conversationId: message.conversationId,
            ok: false,
            error: result.error
          })
        }
        return true
      }
      case 'review': {
        const id = message.conversationId
        if (!this.deps.review) {
          this.send(client, {
            type: 'reviewed',
            conversationId: id,
            ok: false,
            error: 'unavailable',
            set: null
          })
          return true
        }
        void this.deps.review(id, message.action, message.setId).then((result) => {
          if (result.ok) {
            this.send(client, { type: 'reviewed', conversationId: id, ok: true, set: result.set })
          } else {
            this.send(client, {
              type: 'reviewed',
              conversationId: id,
              ok: false,
              error: result.error,
              set: null
            })
          }
        })
        return true
      }
      case 'locate': {
        const id = message.conversationId
        if (!this.deps.locateWorkspace) {
          this.send(client, { type: 'located', conversationId: id, ok: false, error: 'unavailable' })
          return true
        }
        void this.deps.locateWorkspace(id, message.destinationDir).then((result) => {
          if (result.ok) {
            this.send(client, {
              type: 'located',
              conversationId: id,
              ok: true,
              workdir: result.workdir
            })
            const controls = this.deps.listControls(id)
            if (controls) this.send(client, controls)
            this.send(client, { type: 'sessions', sessions: this.deps.listSessions() })
          } else {
            this.send(client, { type: 'located', conversationId: id, ok: false, error: result.error })
          }
        })
        return true
      }
      case 'send': {
        const attachments = this.deps.materializeImages?.(message.images) ?? []
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

  private ackMutation(
    client: HubClient,
    conversationId: string,
    result: RemoteSendResult,
    pushThread: boolean
  ): void {
    if (result === 'ok') {
      this.send(client, { type: 'sent', conversationId })
      if (pushThread) {
        const thread = this.deps.listThread(conversationId)
        if (thread) this.send(client, thread)
      }
      return
    }
    this.send(client, {
      type: 'error',
      code: result,
      message: result === 'archived' ? 'conversation is archived' : 'no such conversation',
      conversationId
    })
  }

  private send(client: HubClient, message: RemoteServerMessage): void {
    if (client.socket.destroyed) return
    client.socket.write(encodeLine(message))
  }

  private broadcast(message: RemoteServerMessage): void {
    const line = encodeLine(message)
    for (const client of this.clients) {
      if (client.authed && !client.socket.destroyed) client.socket.write(line)
    }
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
        const recovery = this.liveRecovery.get(conversationId)
        this.broadcast({
          type: 'turn',
          conversationId,
          phase: awaiting ? 'awaiting' : 'running',
          ...(blocks.length ? { blocks } : {}),
          ...(derived.text ? { draft: derived.text } : {}),
          ...(derived.thinking ? { thinking: derived.thinking } : {}),
          ...(awaiting ? { awaiting } : {}),
          ...(recovery ? { recovery } : {})
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
    this.liveRecovery.delete(conversationId)
  }
}
