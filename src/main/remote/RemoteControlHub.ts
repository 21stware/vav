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
  type RemoteHello,
  type RemoteHostEvent,
  type RemoteNotification,
  type RemoteNotifyKind,
  type RemoteSendImage,
  type RemoteServerMessage,
  type RemoteSession,
  type RemoteThreadBlock,
  type RemoteThreadEvent,
  type RemoteTurnEvent
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
  createSession: () => RemoteSession
  cancel: (conversationId: string) => RemoteSendResult
  reply: (conversationId: string, toolCallId: string, answer: string) => boolean
  rename: (conversationId: string, title: string) => RemoteSendResult
  archive: (conversationId: string) => RemoteSendResult
  browse: (conversationId: string, path?: string) => RemoteDirsEvent | 'not-found' | 'forbidden'
  setWorkspace: (conversationId: string, path: string | null) => RemoteWorkspaceResult
  secret: () => string
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
      if (message.type !== 'hello' || !secretsMatch(message.auth, this.deps.secret())) {
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
}
