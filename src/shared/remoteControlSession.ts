/**
 * Control-plane client session — the TypeScript twin of iOS `RemoteClient`.
 *
 * Transport-agnostic: the caller writes frames and feeds parsed server
 * messages. Desktop and tests share this reducer so they cannot drift from
 * the phone's apply/turn/thread rules.
 */

import {
  REMOTE_PROTO_VERSION,
  type RemoteClientMessage,
  type RemoteControlsEvent,
  type RemoteHostEvent,
  type RemoteServerMessage,
  type RemoteSession,
  type RemoteThreadBlock,
  type RemoteThreadMessage,
  type RemoteTurnEvent
} from './remoteControl.ts'

export type RemoteControlSessionState = {
  welcomed: boolean
  app: string | null
  version: string | null
  host: RemoteHostEvent | null
  sessions: RemoteSession[]
  threads: Record<string, RemoteThreadMessage[]>
  generatingIds: string[]
  drafts: Record<string, string>
  thinkingDrafts: Record<string, string>
  liveBlocks: Record<string, RemoteThreadBlock[]>
  awaiting: Record<string, Extract<RemoteThreadBlock, { kind: 'awaiting' }>>
  controls: Record<string, RemoteControlsEvent>
  lastError: { code: string; message: string; conversationId?: string } | null
}

export function emptyRemoteControlSession(): RemoteControlSessionState {
  return {
    welcomed: false,
    app: null,
    version: null,
    host: null,
    sessions: [],
    threads: {},
    generatingIds: [],
    drafts: {},
    thinkingDrafts: {},
    liveBlocks: {},
    awaiting: {},
    controls: {},
    lastError: null
  }
}

export function remoteHello(
  auth: string,
  device: string,
  role: 'phone' | 'daemon' = 'phone'
): RemoteClientMessage {
  return { type: 'hello', proto: REMOTE_PROTO_VERSION, auth, device, role }
}

export function applyRemoteServerMessage(
  state: RemoteControlSessionState,
  message: RemoteServerMessage
): RemoteControlSessionState {
  switch (message.type) {
    case 'welcome':
      return { ...state, welcomed: true, app: message.app, version: message.version, lastError: null }
    case 'host':
      return { ...state, host: message }
    case 'sessions':
      return {
        ...state,
        sessions: message.sessions,
        generatingIds: state.generatingIds.filter((id) =>
          message.sessions.some((session) => session.id === id && session.status === 'running')
        )
      }
    case 'thread': {
      const complete = threadShowsCompletedTurn(message.messages)
      const waiting = lastAwaiting(message.messages)
      return {
        ...state,
        threads: { ...state.threads, [message.conversationId]: message.messages },
        generatingIds: complete
          ? state.generatingIds.filter((id) => id !== message.conversationId)
          : state.generatingIds,
        drafts: complete ? omitKey(state.drafts, message.conversationId) : state.drafts,
        thinkingDrafts: complete
          ? omitKey(state.thinkingDrafts, message.conversationId)
          : state.thinkingDrafts,
        liveBlocks: complete ? omitKey(state.liveBlocks, message.conversationId) : state.liveBlocks,
        awaiting: waiting
          ? { ...state.awaiting, [message.conversationId]: waiting }
          : omitKey(state.awaiting, message.conversationId)
      }
    }
    case 'turn':
      return applyTurn(state, message)
    case 'controls':
      return {
        ...state,
        controls: { ...state.controls, [message.conversationId]: message }
      }
    case 'created':
      return {
        ...state,
        sessions: [
          message.session,
          ...state.sessions.filter((session) => session.id !== message.session.id)
        ]
      }
    case 'error':
      return {
        ...state,
        lastError: {
          code: message.code,
          message: message.message,
          conversationId: message.conversationId
        },
        generatingIds: message.conversationId
          ? state.generatingIds.filter((id) => id !== message.conversationId)
          : state.generatingIds
      }
    case 'sent':
    case 'pong':
    case 'dirs':
    case 'notification':
      return state
    default:
      return state
  }
}

function applyTurn(
  state: RemoteControlSessionState,
  turn: RemoteTurnEvent
): RemoteControlSessionState {
  const id = turn.conversationId
  if (turn.phase === 'running') {
    return {
      ...state,
      generatingIds: state.generatingIds.includes(id) ? state.generatingIds : [...state.generatingIds, id],
      liveBlocks: turn.blocks ? { ...state.liveBlocks, [id]: turn.blocks } : state.liveBlocks,
      drafts: turn.draft !== undefined ? { ...state.drafts, [id]: turn.draft } : state.drafts,
      thinkingDrafts:
        turn.thinking !== undefined ? { ...state.thinkingDrafts, [id]: turn.thinking } : state.thinkingDrafts,
      awaiting: omitKey(state.awaiting, id),
      sessions: patchSession(state.sessions, id, {
        status: 'running',
        preview: turn.draft || 'Generating…'
      })
    }
  }
  if (turn.phase === 'awaiting') {
    return {
      ...state,
      generatingIds: state.generatingIds.filter((item) => item !== id),
      liveBlocks: turn.blocks ? { ...state.liveBlocks, [id]: turn.blocks } : state.liveBlocks,
      awaiting: turn.awaiting ? { ...state.awaiting, [id]: turn.awaiting } : state.awaiting,
      sessions: patchSession(state.sessions, id, { status: 'running', preview: '等待回复…' })
    }
  }
  if (turn.phase === 'done' || turn.phase === 'error' || turn.phase === 'cancelled') {
    return {
      ...state,
      generatingIds: state.generatingIds.filter((item) => item !== id),
      awaiting: omitKey(state.awaiting, id),
      lastError:
        turn.phase === 'error' && turn.error
          ? { code: 'bad-request', message: turn.error, conversationId: id }
          : state.lastError
    }
  }
  return state
}

function patchSession(
  sessions: RemoteSession[],
  id: string,
  patch: { status: RemoteSession['status']; preview: string }
): RemoteSession[] {
  return sessions.map((session) =>
    session.id === id
      ? { ...session, status: patch.status, preview: patch.preview, updatedAt: Date.now() }
      : session
  )
}

function lastAwaiting(
  messages: RemoteThreadMessage[]
): Extract<RemoteThreadBlock, { kind: 'awaiting' }> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const block = [...(messages[i]?.blocks ?? [])]
      .reverse()
      .find((item) => item.kind === 'awaiting')
    if (block?.kind === 'awaiting') return block
  }
  return undefined
}

function threadShowsCompletedTurn(messages: RemoteThreadMessage[]): boolean {
  const last = [...messages].reverse().find((message) => message.role !== 'system')
  return last?.role === 'assistant'
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}
