/**
 * Remote-control wire protocol (VAV ⇄ phone / desktop control UI).
 *
 * This is the *session* plane: list / create / send / thread / live turn /
 * configure. Workspace fs / pty / spawn live on `daemonProtocol` — same
 * pairing secret, different `hello.role`. Desktop remote windows and the
 * iOS app are isomorphic clients of this module; they must not run a local
 * agent against a copied transcript when the host exposes this plane.
 *
 * Transport: JSON lines (one UTF-8 object per `\n`). Tailcat forwards to a
 * localhost socket; LAN desktop pairing multiplexes the daemon listen port
 * by hello role (`phone` vs `daemon`).
 *
 * Handshake: the client's first line must be a `hello` carrying the pairing
 * secret. Anything else — or a bad secret — gets an `error` line and a close.
 * After a valid hello the server replies `welcome` + a `sessions` snapshot
 * (list metadata only), then `host` and recent alerts. Thread bodies are
 * fetched on demand when the phone opens a conversation. The tunnel is one
 * TCP stream — keep the first paint small.
 * The phone is a first-class session client: create / thread / configure /
 * cancel / reply (ask & approval) / rename / archive / pin / favorite, plus a
 * restricted workdir picker (`browse` + `workspace`). fs contents, pty, spawn,
 * and secrets stay on the daemon protocol — the phone never gets those.
 *
 * This module is pure (no Node imports) so it is unit-testable and shareable
 * with the renderer settings UI.
 */

export const REMOTE_PROTO_VERSION = 1

/** Tunnel-side TCP port the iOS client dials. Mirrors sidecar bridgePort. */
export const REMOTE_BRIDGE_PORT = 4747

export type RemoteNotifyKind = 'turn-complete' | 'ask' | 'approval' | 'request'

/** One conversation row in the remote session list. */
export type RemoteSession = {
  id: string
  title: string
  /** Compact workdir label (`~/repo/vav`), '' when unknown. */
  dirLabel: string
  /** running: a turn is streaming; done: finished and unseen; idle: at rest. */
  status: 'running' | 'done' | 'idle'
  /** vav built-in loop or external CLI agent host. */
  surface: 'vav' | 'cli'
  updatedAt: number
  /** Last turn on the active path, plain text, may be empty. */
  preview?: string
  /** Absolute workdir on the host; omitted on older snapshots. */
  workdir?: string
  /** True when the workdir is a Temporary Workspace. */
  temporary?: boolean
  /** Same pin as the desktop sidebar. Older phones ignore this. */
  pinned?: boolean
  /** When the pin was set (ms); orders the pinned section. */
  pinTime?: number
  /** Starred on the host (`favoriteConversationIds`). Older phones ignore this. */
  favorite?: boolean
}

export type RemoteThreadBlock =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | {
      kind: 'tool'
      id: string
      tool: string
      /** Localized card name (`读取文件`). Older phones ignore this. */
      name?: string
      summary: string
      status: string
    }
  | { kind: 'plan'; title: string; steps: { text: string; done: boolean }[] }
  | {
      kind: 'awaiting'
      id: string
      tool: string
      name?: string
      title: string
      prompt: string
      choices: RemoteChoice[]
      multiSelect?: boolean
    }

export type RemoteThreadMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  at: number
  /** Structured log blocks; older phones ignore this and use `text`. */
  blocks?: RemoteThreadBlock[]
  cancelled?: boolean
  error?: string
}

// --- client → server ---

export type RemoteHello = {
  type: 'hello'
  proto: number
  auth: string
  /** Human-readable device name, shown in VAV's paired-devices UI. */
  device?: string
  /**
   * `daemon` = workspace-host RPC (fs / spawn / pty). Omitted / `phone` stays
   * on this control-plane protocol. Same tailcat pipe, different layer.
   */
  role?: 'phone' | 'daemon'
}

export type RemoteSendImage = {
  name: string
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
  /** Raw base64 (no data: prefix). Cap is the line-size budget. */
  data: string
}

export type RemoteSend = {
  type: 'send'
  conversationId: string
  /** May be blank when `images` carries the payload. */
  text: string
  images?: RemoteSendImage[]
}

export type RemoteSessionsRequest = { type: 'sessions' }
export type RemoteCreate = { type: 'create' }
export type RemoteThreadRequest = { type: 'thread'; conversationId: string }
export type RemoteControlsRequest = { type: 'controls'; conversationId: string }
export type RemoteCancel = { type: 'cancel'; conversationId: string }
export type RemoteReply = { type: 'reply'; conversationId: string; toolCallId: string; answer: string }
export type RemoteRename = { type: 'rename'; conversationId: string; title: string }
export type RemoteArchive = { type: 'archive'; conversationId: string }
export type RemotePin = { type: 'pin'; conversationId: string; pinned: boolean }
export type RemoteFavorite = { type: 'favorite'; conversationId: string; favorite: boolean }
/** List directories the phone may pick (home / recents / current). */
export type RemoteBrowse = { type: 'browse'; conversationId: string; path?: string }
/**
 * Set this session's workdir. `path` omitted or `temp: true` mints a
 * Temporary Workspace on the host (same as desktop).
 */
export type RemoteWorkspace = {
  type: 'workspace'
  conversationId: string
  path?: string
  temp?: boolean
}
export type RemotePing = { type: 'ping' }

export type RemoteChoice = { id: string; label: string }

/** Composer run-bar snapshot for one conversation. */
export type RemoteControlsEvent = {
  type: 'controls'
  conversationId: string
  /** True once the session has a turn — agent switch is locked, like desktop. */
  agentLocked: boolean
  /** `vav` or a structured CLI host id. */
  agent: string
  agents: RemoteChoice[]
  model: string
  models: RemoteChoice[]
  /** Null when this host/model has no thinking chip. */
  thinking: string | null
  thinkingLevels: RemoteChoice[]
  /** Null when the CLI host has not advertised session modes. */
  mode: string | null
  modes: RemoteChoice[]
  approval: 'auto' | 'bypass' | 'edit'
  approvals: RemoteChoice[]
  /** Null when this host has no Fast chip (Cursor only on desktop). */
  fast: boolean | null
  workingDirectory: string
  dirLabel: string
  temporary: boolean
}

export type RemoteConfigure = {
  type: 'configure'
  conversationId: string
  agent?: string
  model?: string
  thinkingLevel?: string
  mode?: string
  approvalMode?: string
  fast?: boolean
}

export type RemoteClientMessage =
  | RemoteHello
  | RemoteSend
  | RemoteSessionsRequest
  | RemoteCreate
  | RemoteThreadRequest
  | RemoteControlsRequest
  | RemoteConfigure
  | RemoteCancel
  | RemoteReply
  | RemoteRename
  | RemoteArchive
  | RemotePin
  | RemoteFavorite
  | RemoteBrowse
  | RemoteWorkspace
  | RemotePing

// --- server → client ---

export type RemoteWelcome = {
  type: 'welcome'
  proto: number
  app: string
  version: string
}

export type RemoteSessionsEvent = {
  type: 'sessions'
  sessions: RemoteSession[]
}

export type RemoteThreadEvent = {
  type: 'thread'
  conversationId: string
  messages: RemoteThreadMessage[]
}

export type RemoteNotification = {
  type: 'notification'
  kind: RemoteNotifyKind
  conversationId: string
  title: string
  body: string
  at: number
}

export type RemoteSent = {
  type: 'sent'
  conversationId: string
}

export type RemoteCreated = {
  type: 'created'
  session: RemoteSession
}

/** What this phone is allowed to do. Secrets / pty / spawn are never true. */
export type RemoteCapabilities = {
  cancel: boolean
  reply: boolean
  rename: boolean
  archive: boolean
  pin: boolean
  favorite: boolean
  workdirPick: boolean
  /** Always false on this control plane. */
  attachments: boolean
  pty: boolean
  spawn: boolean
  fsRead: boolean
  keys: boolean
}

export const REMOTE_PHONE_CAPABILITIES: RemoteCapabilities = {
  cancel: true,
  reply: true,
  rename: true,
  archive: true,
  pin: true,
  favorite: true,
  workdirPick: true,
  attachments: false,
  pty: false,
  spawn: false,
  fsRead: false,
  keys: false
}

export type RemoteHostEvent = {
  type: 'host'
  name: string
  home: string
  tmp: string
  platform?: string
  capabilities: RemoteCapabilities
  defaults: {
    agent: string
    model: string
    thinking: string | null
    approval: 'auto' | 'bypass' | 'edit'
  }
  recentDirs: { path: string; label: string }[]
}

export type RemoteTurnEvent = {
  type: 'turn'
  conversationId: string
  phase: 'running' | 'awaiting' | 'done' | 'error' | 'cancelled'
  /** Coalesced assistant markdown so far; omitted on awaiting/start. */
  draft?: string
  /** Coalesced thinking / reasoning so far — streamed with `draft`. */
  thinking?: string
  /**
   * Live assistant blocks in desktop slot order (think → tool → text).
   * Newer phones render this; older ones still use `thinking` + `draft`.
   */
  blocks?: RemoteThreadBlock[]
  awaiting?: Extract<RemoteThreadBlock, { kind: 'awaiting' }>
  error?: string
}

export type RemoteDirEntry = { name: string; path: string }

export type RemoteDirsEvent = {
  type: 'dirs'
  conversationId: string
  path: string
  parent: string | null
  entries: RemoteDirEntry[]
}

export type RemoteError = {
  type: 'error'
  code: 'auth' | 'bad-request' | 'not-found' | 'archived' | 'locked' | 'forbidden'
  message: string
  /** Present when the error is about a specific conversation (thread / send). */
  conversationId?: string
}

export type RemotePong = { type: 'pong' }

export type RemoteServerMessage =
  | RemoteWelcome
  | RemoteHostEvent
  | RemoteSessionsEvent
  | RemoteThreadEvent
  | RemoteControlsEvent
  | RemoteTurnEvent
  | RemoteDirsEvent
  | RemoteNotification
  | RemoteSent
  | RemoteCreated
  | RemoteError
  | RemotePong

// --- framing ---

/**
 * Pull complete JSON lines off an accumulating buffer.
 * Returns parsed values (invalid JSON lines surface as null so the caller can
 * drop the connection) and the unconsumed tail.
 */
export function drainJsonLines(buffer: string): { values: (unknown | null)[]; rest: string } {
  const values: (unknown | null)[] = []
  let start = 0
  for (;;) {
    const nl = buffer.indexOf('\n', start)
    if (nl === -1) break
    const line = buffer.slice(start, nl).trim()
    start = nl + 1
    if (!line) continue
    try {
      values.push(JSON.parse(line) as unknown)
    } catch {
      values.push(null)
    }
  }
  return { values, rest: buffer.slice(start) }
}

export function encodeLine(message: RemoteServerMessage | RemoteClientMessage): string {
  return `${JSON.stringify(message)}\n`
}

/** Desktop sidebar order: pinned (newest pin first), then updatedAt. */
export function compareRemoteSessions(
  a: Pick<RemoteSession, 'pinned' | 'pinTime' | 'updatedAt'>,
  b: Pick<RemoteSession, 'pinned' | 'pinTime' | 'updatedAt'>
): number {
  const aPinned = a.pinned === true
  const bPinned = b.pinned === true
  if (aPinned !== bPinned) return aPinned ? -1 : 1
  if (aPinned && bPinned) return (b.pinTime ?? 0) - (a.pinTime ?? 0)
  return b.updatedAt - a.updatedAt
}

/** Cap a single inbound frame; anything larger is a hostile or broken peer. */
export const REMOTE_MAX_LINE_BYTES = 256 * 1024

// --- message validation (structural; auth comparison stays in main) ---

const SEND_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
/** One image must fit under REMOTE_MAX_LINE_BYTES after JSON + base64 wrap. */
const SEND_IMAGE_DATA_CAP = 180_000

function parseSendImages(value: unknown): RemoteSendImage[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const images: RemoteSendImage[] = []
  for (const item of value.slice(0, 4)) {
    if (typeof item !== 'object' || item === null) continue
    const raw = item as Record<string, unknown>
    if (typeof raw.name !== 'string' || typeof raw.mime !== 'string' || typeof raw.data !== 'string') {
      continue
    }
    if (!SEND_IMAGE_MIMES.has(raw.mime)) continue
    if (raw.data.length === 0 || raw.data.length > SEND_IMAGE_DATA_CAP) continue
    images.push({
      name: raw.name.slice(0, 80),
      mime: raw.mime as RemoteSendImage['mime'],
      data: raw.data
    })
  }
  return images.length ? images : undefined
}

export function parseClientMessage(value: unknown): RemoteClientMessage | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  switch (raw.type) {
    case 'hello': {
      if (typeof raw.auth !== 'string' || raw.auth.length === 0) return null
      if (typeof raw.proto !== 'number') return null
      const device = typeof raw.device === 'string' ? raw.device : undefined
      const role = raw.role === 'daemon' || raw.role === 'phone' ? raw.role : undefined
      return role
        ? { type: 'hello', proto: raw.proto, auth: raw.auth, device, role }
        : { type: 'hello', proto: raw.proto, auth: raw.auth, device }
    }
    case 'send': {
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      const text = typeof raw.text === 'string' ? raw.text : ''
      const images = parseSendImages(raw.images)
      if (!images && text.trim().length === 0) return null
      return images
        ? { type: 'send', conversationId: raw.conversationId, text, images }
        : { type: 'send', conversationId: raw.conversationId, text }
    }
    case 'sessions':
      return { type: 'sessions' }
    case 'create':
      return { type: 'create' }
    case 'thread': {
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      return { type: 'thread', conversationId: raw.conversationId }
    }
    case 'controls': {
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      return { type: 'controls', conversationId: raw.conversationId }
    }
    case 'configure': {
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      const agent = typeof raw.agent === 'string' ? raw.agent : undefined
      const model = typeof raw.model === 'string' ? raw.model : undefined
      const thinkingLevel = typeof raw.thinkingLevel === 'string' ? raw.thinkingLevel : undefined
      const mode = typeof raw.mode === 'string' ? raw.mode : undefined
      const approvalMode = typeof raw.approvalMode === 'string' ? raw.approvalMode : undefined
      const fast = typeof raw.fast === 'boolean' ? raw.fast : undefined
      if (
        agent === undefined &&
        model === undefined &&
        thinkingLevel === undefined &&
        mode === undefined &&
        approvalMode === undefined &&
        fast === undefined
      ) {
        return null
      }
      return {
        type: 'configure',
        conversationId: raw.conversationId,
        ...(agent !== undefined ? { agent } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
        ...(mode !== undefined ? { mode } : {}),
        ...(approvalMode !== undefined ? { approvalMode } : {}),
        ...(fast !== undefined ? { fast } : {})
      }
    }
    case 'cancel': {
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      return { type: 'cancel', conversationId: raw.conversationId }
    }
    case 'reply': {
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      if (typeof raw.toolCallId !== 'string' || raw.toolCallId.length === 0) return null
      if (typeof raw.answer !== 'string' || raw.answer.trim().length === 0) return null
      return {
        type: 'reply',
        conversationId: raw.conversationId,
        toolCallId: raw.toolCallId,
        answer: raw.answer
      }
    }
    case 'rename': {
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      if (typeof raw.title !== 'string') return null
      const title = raw.title.trim()
      if (!title) return null
      return { type: 'rename', conversationId: raw.conversationId, title: title.slice(0, 120) }
    }
    case 'archive': {
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      return { type: 'archive', conversationId: raw.conversationId }
    }
    case 'pin': {
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      if (typeof raw.pinned !== 'boolean') return null
      return { type: 'pin', conversationId: raw.conversationId, pinned: raw.pinned }
    }
    case 'favorite': {
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      if (typeof raw.favorite !== 'boolean') return null
      return { type: 'favorite', conversationId: raw.conversationId, favorite: raw.favorite }
    }
    case 'browse': {
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      const path = typeof raw.path === 'string' && raw.path.length > 0 ? raw.path : undefined
      return path
        ? { type: 'browse', conversationId: raw.conversationId, path }
        : { type: 'browse', conversationId: raw.conversationId }
    }
    case 'workspace': {
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      const path = typeof raw.path === 'string' && raw.path.length > 0 ? raw.path : undefined
      const temp = raw.temp === true
      if (!path && !temp) return null
      return {
        type: 'workspace',
        conversationId: raw.conversationId,
        ...(path ? { path } : {}),
        ...(temp ? { temp: true } : {})
      }
    }
    case 'ping':
      return { type: 'ping' }
    default:
      return null
  }
}

function parseRemoteSession(value: unknown): RemoteSession | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  if (typeof raw.title !== 'string') return null
  const status =
    raw.status === 'running' || raw.status === 'done' || raw.status === 'idle' ? raw.status : 'idle'
  const surface = raw.surface === 'cli' ? 'cli' : 'vav'
  return {
    id: raw.id,
    title: raw.title,
    dirLabel: typeof raw.dirLabel === 'string' ? raw.dirLabel : '',
    status,
    surface,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    ...(typeof raw.preview === 'string' ? { preview: raw.preview } : {}),
    ...(typeof raw.workdir === 'string' ? { workdir: raw.workdir } : {}),
    ...(typeof raw.temporary === 'boolean' ? { temporary: raw.temporary } : {})
  }
}

function parseRemoteBlock(value: unknown): RemoteThreadBlock | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  switch (raw.kind) {
    case 'text':
    case 'reasoning':
      return { kind: raw.kind, text: typeof raw.text === 'string' ? raw.text : '' }
    case 'tool':
      if (typeof raw.id !== 'string' || typeof raw.tool !== 'string') return null
      return {
        kind: 'tool',
        id: raw.id,
        tool: raw.tool,
        ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
        summary: typeof raw.summary === 'string' ? raw.summary : '',
        status: typeof raw.status === 'string' ? raw.status : ''
      }
    case 'plan':
      return {
        kind: 'plan',
        title: typeof raw.title === 'string' ? raw.title : '',
        steps: Array.isArray(raw.steps)
          ? raw.steps
              .filter((step): step is { text: unknown; done: unknown } => typeof step === 'object' && step !== null)
              .map((step) => ({
                text: typeof step.text === 'string' ? step.text : '',
                done: step.done === true
              }))
          : []
      }
    case 'awaiting': {
      if (typeof raw.id !== 'string' || typeof raw.tool !== 'string') return null
      const choices = Array.isArray(raw.choices)
        ? raw.choices
            .filter((choice): choice is { id: unknown; label: unknown } => typeof choice === 'object' && choice !== null)
            .map((choice) => ({
              id: typeof choice.id === 'string' ? choice.id : '',
              label: typeof choice.label === 'string' ? choice.label : ''
            }))
            .filter((choice) => choice.id && choice.label)
        : []
      return {
        kind: 'awaiting',
        id: raw.id,
        tool: raw.tool,
        ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
        title: typeof raw.title === 'string' ? raw.title : '',
        prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
        choices,
        ...(raw.multiSelect === true ? { multiSelect: true } : {})
      }
    }
    default:
      return null
  }
}

function parseRemoteThreadMessage(value: unknown): RemoteThreadMessage | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  if (raw.role !== 'user' && raw.role !== 'assistant' && raw.role !== 'system') return null
  const blocks = Array.isArray(raw.blocks)
    ? raw.blocks.map(parseRemoteBlock).filter((block): block is RemoteThreadBlock => block !== null)
    : undefined
  return {
    id: raw.id,
    role: raw.role,
    text: typeof raw.text === 'string' ? raw.text : '',
    at: typeof raw.at === 'number' ? raw.at : 0,
    ...(blocks?.length ? { blocks } : {}),
    ...(raw.cancelled === true ? { cancelled: true } : {}),
    ...(typeof raw.error === 'string' ? { error: raw.error } : {})
  }
}

/**
 * Server → client frames. Mirrors iOS `ServerFrame.parse` so desktop and
 * phone share one acceptance contract.
 */
export function parseServerMessage(value: unknown): RemoteServerMessage | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  switch (raw.type) {
    case 'welcome':
      if (typeof raw.proto !== 'number' || typeof raw.app !== 'string') return null
      return {
        type: 'welcome',
        proto: raw.proto,
        app: raw.app,
        version: typeof raw.version === 'string' ? raw.version : ''
      }
    case 'sessions': {
      if (!Array.isArray(raw.sessions)) return null
      return {
        type: 'sessions',
        sessions: raw.sessions
          .map(parseRemoteSession)
          .filter((session): session is RemoteSession => session !== null)
      }
    }
    case 'thread': {
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      const messages = Array.isArray(raw.messages)
        ? raw.messages
            .map(parseRemoteThreadMessage)
            .filter((message): message is RemoteThreadMessage => message !== null)
        : []
      return { type: 'thread', conversationId: raw.conversationId, messages }
    }
    case 'turn': {
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      if (
        raw.phase !== 'running' &&
        raw.phase !== 'awaiting' &&
        raw.phase !== 'done' &&
        raw.phase !== 'error' &&
        raw.phase !== 'cancelled'
      ) {
        return null
      }
      const blocks = Array.isArray(raw.blocks)
        ? raw.blocks.map(parseRemoteBlock).filter((block): block is RemoteThreadBlock => block !== null)
        : undefined
      const awaiting = raw.awaiting ? parseRemoteBlock(raw.awaiting) : null
      return {
        type: 'turn',
        conversationId: raw.conversationId,
        phase: raw.phase,
        ...(typeof raw.draft === 'string' ? { draft: raw.draft } : {}),
        ...(typeof raw.thinking === 'string' ? { thinking: raw.thinking } : {}),
        ...(blocks?.length ? { blocks } : {}),
        ...(awaiting?.kind === 'awaiting' ? { awaiting } : {}),
        ...(typeof raw.error === 'string' ? { error: raw.error } : {})
      }
    }
    case 'controls': {
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      return raw as RemoteControlsEvent
    }
    case 'host': {
      if (typeof raw.name !== 'string') return null
      return raw as RemoteHostEvent
    }
    case 'dirs': {
      if (typeof raw.conversationId !== 'string' || typeof raw.path !== 'string') return null
      return raw as RemoteDirsEvent
    }
    case 'notification': {
      if (typeof raw.conversationId !== 'string' || typeof raw.kind !== 'string') return null
      return raw as RemoteNotification
    }
    case 'sent':
      if (typeof raw.conversationId !== 'string' || raw.conversationId.length === 0) return null
      return { type: 'sent', conversationId: raw.conversationId }
    case 'created': {
      const session = parseRemoteSession(raw.session)
      if (!session) return null
      return { type: 'created', session }
    }
    case 'error': {
      const code =
        raw.code === 'auth' ||
        raw.code === 'bad-request' ||
        raw.code === 'not-found' ||
        raw.code === 'archived' ||
        raw.code === 'locked' ||
        raw.code === 'forbidden'
          ? raw.code
          : 'bad-request'
      return {
        type: 'error',
        code,
        message: typeof raw.message === 'string' ? raw.message : '',
        ...(typeof raw.conversationId === 'string' ? { conversationId: raw.conversationId } : {})
      }
    }
    case 'pong':
      return { type: 'pong' }
    default:
      return null
  }
}

// --- settings UI status (main → renderer over IPC) ---

export type RemoteControlState = 'disabled' | 'no-binary' | 'starting' | 'ready' | 'error'

export type RemoteControlStatus = {
  state: RemoteControlState
  /** QR payload (`vav-remote:{…}`), present once the tunnel is ready. */
  pairing: string | null
  /** Currently connected sockets. */
  clients: { device: string; since: number }[]
  /** Devices that have authed on this secret, including offline ones. */
  devices?: { device: string; lastSeen: number; connected: boolean }[]
  error: string | null
}

// --- pairing ---

/**
 * Payload encoded into the settings QR code. `secret` gates the tunnel
 * (the token alone is just an address — anyone holding it can dial).
 */
export type RemotePairing = {
  v: number
  token: string
  secret: string
  /** Mac's display name, so the phone can label the pairing. */
  host?: string
}

export function encodePairing(pairing: RemotePairing): string {
  return `vav-remote:${JSON.stringify(pairing)}`
}

export function parsePairing(text: string): RemotePairing | null {
  if (!text.startsWith('vav-remote:')) return null
  try {
    const raw = JSON.parse(text.slice('vav-remote:'.length)) as Record<string, unknown>
    if (typeof raw.token !== 'string' || !raw.token.startsWith('tc')) return null
    if (typeof raw.secret !== 'string' || raw.secret.length < 16) return null
    if (typeof raw.v !== 'number') return null
    return {
      v: raw.v,
      token: raw.token,
      secret: raw.secret,
      host: typeof raw.host === 'string' ? raw.host : undefined
    }
  } catch {
    return null
  }
}
