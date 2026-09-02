/**
 * Desktop control-plane client. Same hello / frames as iOS RemoteClient,
 * over a raw TCP socket (LAN daemon port or a tailcat --dial).
 */

import { createConnection, type Socket } from 'node:net'
import {
  encodeLine,
  parseServerMessage,
  type RemoteClientMessage,
  type RemoteConfigure,
  type RemoteServerMessage
} from '../../shared/remoteControl.ts'
import {
  applyRemoteServerMessage,
  emptyRemoteControlSession,
  remoteHello,
  type RemoteControlSessionState
} from '../../shared/remoteControlSession.ts'
import { drainJsonLines, REMOTE_MAX_LINE_BYTES } from '../../shared/remoteControl.ts'

const CONNECT_TIMEOUT_MS = 4_000
const WELCOME_TIMEOUT_MS = 400

export class RemoteControlDial {
  private socket: Socket | null = null
  private buffer = ''
  private state = emptyRemoteControlSession()
  private readonly listeners = new Set<(state: RemoteControlSessionState, message: RemoteServerMessage) => void>()
  ready = false

  snapshot(): RemoteControlSessionState {
    return this.state
  }

  onFrame(listener: (state: RemoteControlSessionState, message: RemoteServerMessage) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async connect(opts: {
    host: string
    port: number
    secret: string
    device: string
    timeoutMs?: number
  }): Promise<RemoteControlSessionState> {
    this.close()
    const socket = createConnection({ host: opts.host, port: opts.port })
    this.socket = socket
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('control plane connect timed out')),
        opts.timeoutMs ?? CONNECT_TIMEOUT_MS
      )
      socket.once('connect', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => this.ingest(chunk))
    const closed = (): void => {
      this.ready = false
      if (this.socket === socket) this.socket = null
    }
    socket.on('close', closed)
    socket.on('error', closed)
    this.write(remoteHello(opts.secret, opts.device, 'phone'))
    const welcomed = await this.waitFor(
      (state) => state.welcomed || state.lastError !== null,
      opts.timeoutMs ?? WELCOME_TIMEOUT_MS
    )
    if (welcomed.lastError) {
      throw new Error(welcomed.lastError.message || welcomed.lastError.code)
    }
    this.ready = welcomed.welcomed
    if (!this.ready) throw new Error('control plane did not welcome')
    return welcomed
  }

  send(conversationId: string, text: string): void {
    this.write({ type: 'send', conversationId, text })
  }

  configure(
    conversationId: string,
    patch: Omit<RemoteConfigure, 'type' | 'conversationId'>
  ): void {
    this.write({ type: 'configure', conversationId, ...patch })
  }

  rename(conversationId: string, title: string): void {
    this.write({ type: 'rename', conversationId, title })
  }

  archive(conversationId: string): void {
    this.write({ type: 'archive', conversationId })
  }

  cancel(conversationId: string): void {
    this.write({ type: 'cancel', conversationId })
  }

  reply(conversationId: string, toolCallId: string, answer: string): void {
    this.write({ type: 'reply', conversationId, toolCallId, answer })
  }

  create(): void {
    this.write({ type: 'create' })
  }

  async createSession(timeoutMs = 5_000): Promise<string> {
    const before = new Set(this.state.sessions.map((session) => session.id))
    this.create()
    const next = await this.waitFor(
      (state) => state.sessions.some((session) => !before.has(session.id)),
      timeoutMs
    )
    const created = next.sessions.find((session) => !before.has(session.id))
    if (!created) throw new Error('control plane create produced no session')
    return created.id
  }

  requestThread(conversationId: string): void {
    this.write({ type: 'thread', conversationId })
  }

  setWorkspace(conversationId: string, path: string | null): void {
    if (path) this.write({ type: 'workspace', conversationId, path })
    else this.write({ type: 'workspace', conversationId, temp: true })
  }

  close(): void {
    this.ready = false
    this.buffer = ''
    this.state = emptyRemoteControlSession()
    this.socket?.destroy()
    this.socket = null
  }

  private write(message: RemoteClientMessage): void {
    if (!this.socket || this.socket.destroyed) return
    this.socket.write(encodeLine(message))
  }

  private ingest(chunk: string): void {
    this.buffer += chunk
    if (this.buffer.length > REMOTE_MAX_LINE_BYTES) {
      this.close()
      return
    }
    const { values, rest } = drainJsonLines(this.buffer)
    this.buffer = rest
    for (const value of values) {
      const parsed = parseServerMessage(value)
      if (!parsed) continue
      this.state = applyRemoteServerMessage(this.state, parsed)
      for (const listener of this.listeners) listener(this.state, parsed)
    }
  }

  private waitFor(
    match: (state: RemoteControlSessionState) => boolean,
    timeoutMs: number
  ): Promise<RemoteControlSessionState> {
    if (match(this.state)) return Promise.resolve(this.state)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error('control plane welcome timed out'))
      }, timeoutMs)
      const off = this.onFrame((state) => {
        if (!match(state)) return
        clearTimeout(timer)
        off()
        resolve(state)
      })
    })
  }
}
