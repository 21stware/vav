/**
 * Session-plane operations shared by vav-board (herdr-style control) and vav-tui
 * (pi-style agent). All traffic is the phone protocol against a running vav-server.
 */
import type { RemoteSession, RemoteServerMessage, RemoteTurnEvent } from '../../shared/remoteControl.ts'
import type { PhoneClient } from './vavPhoneClient.ts'

export function lastOfType<T extends RemoteServerMessage['type']>(
  frames: RemoteServerMessage[],
  type: T
): Extract<RemoteServerMessage, { type: T }> | null {
  return (frames.findLast((msg) => msg.type === type) as Extract<RemoteServerMessage, { type: T }> | undefined) ?? null
}

export async function listSessions(phone: PhoneClient): Promise<RemoteSession[]> {
  phone.send({ type: 'sessions' })
  const frames = await phone.waitNew((msg) => msg.type === 'sessions')
  return lastOfType(frames, 'sessions')?.sessions ?? []
}

export async function createSession(phone: PhoneClient): Promise<RemoteSession> {
  phone.send({ type: 'create' })
  const frames = await phone.waitNew((msg) => msg.type === 'created')
  const created = lastOfType(frames, 'created')
  if (!created?.session) throw new Error('create failed')
  return created.session
}

export async function setWorkspace(
  phone: PhoneClient,
  conversationId: string,
  path?: string,
  temp?: boolean
): Promise<void> {
  phone.send({
    type: 'workspace',
    conversationId,
    ...(path ? { path } : {}),
    ...(temp ? { temp: true } : {})
  })
  await phone.waitNew(
    (msg) =>
      (msg.type === 'controls' && msg.conversationId === conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId),
    8000
  )
  const err = phone.frames.findLast((msg) => msg.type === 'error' && msg.conversationId === conversationId)
  if (err && err.type === 'error') throw new Error(err.message)
}

export async function renameSession(phone: PhoneClient, conversationId: string, title: string): Promise<void> {
  phone.send({ type: 'rename', conversationId, title })
  await phone.waitNew((msg) => msg.type === 'sessions' || (msg.type === 'error' && msg.conversationId === conversationId))
}

export async function archiveSession(phone: PhoneClient, conversationId: string): Promise<void> {
  phone.send({ type: 'archive', conversationId })
  await phone.waitNew((msg) => msg.type === 'sessions' || (msg.type === 'error' && msg.conversationId === conversationId))
}

export async function cancelSession(phone: PhoneClient, conversationId: string): Promise<void> {
  phone.send({ type: 'cancel', conversationId })
  await phone.waitNew(
    (msg) =>
      (msg.type === 'turn' && msg.conversationId === conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId),
    8000
  )
}

export async function configureSession(
  phone: PhoneClient,
  conversationId: string,
  patch: { model?: string; approval?: string; thinking?: string; agent?: string; mode?: string }
): Promise<RemoteServerMessage | null> {
  if (!patch.model && !patch.approval && !patch.thinking && !patch.agent && !patch.mode) {
    throw new Error('pass --model, --approval, --thinking, --agent, or --mode')
  }
  phone.send({
    type: 'configure',
    conversationId,
    ...(patch.model ? { model: patch.model } : {}),
    ...(patch.approval ? { approvalMode: patch.approval } : {}),
    ...(patch.thinking ? { thinkingLevel: patch.thinking } : {}),
    ...(patch.agent ? { agent: patch.agent } : {}),
    ...(patch.mode ? { mode: patch.mode } : {})
  })
  const frames = await phone.waitNew(
    (msg) =>
      (msg.type === 'controls' && msg.conversationId === conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId)
  )
  const err = lastOfType(frames, 'error')
  if (err) throw new Error(err.message)
  return lastOfType(frames, 'controls')
}

export async function fetchThread(phone: PhoneClient, conversationId: string): Promise<RemoteServerMessage | null> {
  phone.send({ type: 'thread', conversationId })
  const frames = await phone.waitNew(
    (msg) =>
      (msg.type === 'thread' && msg.conversationId === conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId)
  )
  const err = lastOfType(frames, 'error')
  if (err) throw new Error(err.message)
  return lastOfType(frames, 'thread')
}

export async function fetchControls(phone: PhoneClient, conversationId: string): Promise<RemoteServerMessage | null> {
  phone.send({ type: 'controls', conversationId })
  const frames = await phone.waitNew(
    (msg) =>
      (msg.type === 'controls' && msg.conversationId === conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId)
  )
  const err = lastOfType(frames, 'error')
  if (err) throw new Error(err.message)
  return lastOfType(frames, 'controls')
}

export async function pinSession(phone: PhoneClient, conversationId: string, pinned: boolean): Promise<void> {
  phone.send({ type: 'pin', conversationId, pinned })
  await phone.waitNew((msg) => msg.type === 'sessions' || (msg.type === 'error' && msg.conversationId === conversationId))
  const err = phone.frames.findLast((msg) => msg.type === 'error' && msg.conversationId === conversationId)
  if (err && err.type === 'error') throw new Error(err.message)
}

export async function favoriteSession(phone: PhoneClient, conversationId: string, favorite: boolean): Promise<void> {
  phone.send({ type: 'favorite', conversationId, favorite })
  await phone.waitNew((msg) => msg.type === 'sessions' || (msg.type === 'error' && msg.conversationId === conversationId))
  const err = phone.frames.findLast((msg) => msg.type === 'error' && msg.conversationId === conversationId)
  if (err && err.type === 'error') throw new Error(err.message)
}

export async function replySession(
  phone: PhoneClient,
  conversationId: string,
  toolCallId: string,
  answer: string
): Promise<void> {
  if (!toolCallId.trim() || !answer.trim()) throw new Error('vav-board session reply <id> <toolCallId> <answer>')
  phone.send({ type: 'reply', conversationId, toolCallId, answer })
  await phone.waitNew(
    (msg) =>
      (msg.type === 'turn' && msg.conversationId === conversationId) ||
      (msg.type === 'sent' && msg.conversationId === conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId),
    8000
  )
  const err = phone.frames.findLast((msg) => msg.type === 'error' && msg.conversationId === conversationId)
  if (err && err.type === 'error') throw new Error(err.message)
}

export async function browseWorkspace(
  phone: PhoneClient,
  conversationId: string,
  path?: string,
  files = false
): Promise<Extract<RemoteServerMessage, { type: 'dirs' }>> {
  phone.send({
    type: 'browse',
    conversationId,
    ...(path ? { path } : {}),
    ...(files ? { files: true } : {})
  })
  const frames = await phone.waitNew(
    (msg) =>
      (msg.type === 'dirs' && msg.conversationId === conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId)
  )
  const err = lastOfType(frames, 'error')
  if (err) throw new Error(err.message)
  const dirs = lastOfType(frames, 'dirs')
  if (!dirs) throw new Error('browse failed')
  return dirs
}

export function isTurnSettled(msg: RemoteServerMessage, conversationId: string): boolean {
  return (
    msg.type === 'turn' &&
    msg.conversationId === conversationId &&
    (msg.phase === 'done' || msg.phase === 'error' || msg.phase === 'cancelled')
  )
}

export async function duplicateSession(phone: PhoneClient, conversationId: string): Promise<RemoteSession> {
  phone.send({ type: 'duplicate', conversationId })
  const frames = await phone.waitNew(
    (msg) =>
      (msg.type === 'created' && msg.session.id !== conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId)
  )
  const err = lastOfType(frames, 'error')
  if (err) throw new Error(err.message)
  const created = lastOfType(frames, 'created')
  if (!created?.session) throw new Error('duplicate failed')
  return created.session
}

export async function continueSession(
  phone: PhoneClient,
  conversationId: string,
  messageId: string
): Promise<RemoteSession> {
  if (!messageId) throw new Error('vav-board session continue <id> <messageId>')
  phone.send({ type: 'continue', conversationId, messageId })
  const frames = await phone.waitNew(
    (msg) =>
      (msg.type === 'created' && msg.session.id !== conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId)
  )
  const err = lastOfType(frames, 'error')
  if (err) throw new Error(err.message)
  const created = lastOfType(frames, 'created')
  if (!created?.session) throw new Error('continue failed')
  return created.session
}

export async function regenerateSession(
  phone: PhoneClient,
  conversationId: string,
  messageId: string,
  timeoutMs = 120_000
): Promise<RemoteTurnEvent> {
  if (!messageId) throw new Error('message id required')
  phone.send({ type: 'regenerate', conversationId, messageId })
  const frames = await phone.waitNew(
    (msg) =>
      isTurnSettled(msg, conversationId) || (msg.type === 'error' && msg.conversationId === conversationId),
    timeoutMs
  )
  const err = lastOfType(frames, 'error')
  if (err) throw new Error(err.message)
  const done = frames.findLast((msg) => isTurnSettled(msg, conversationId))
  if (!done || done.type !== 'turn') throw new Error('regenerate did not finish')
  return done
}

export async function editSession(
  phone: PhoneClient,
  conversationId: string,
  messageId: string,
  text: string,
  timeoutMs = 120_000
): Promise<RemoteTurnEvent> {
  if (!messageId || !text.trim()) throw new Error('vav-board session edit <id> <messageId> <text>')
  phone.send({ type: 'edit', conversationId, messageId, text })
  const frames = await phone.waitNew(
    (msg) =>
      isTurnSettled(msg, conversationId) || (msg.type === 'error' && msg.conversationId === conversationId),
    timeoutMs
  )
  const err = lastOfType(frames, 'error')
  if (err) throw new Error(err.message)
  const done = frames.findLast((msg) => isTurnSettled(msg, conversationId))
  if (!done || done.type !== 'turn') throw new Error('edit did not finish')
  return done
}

export async function forkSession(
  phone: PhoneClient,
  conversationId: string,
  messageId: string
): Promise<void> {
  if (!messageId) throw new Error('message id required')
  phone.send({ type: 'fork', conversationId, messageId })
  const frames = await phone.waitNew(
    (msg) =>
      (msg.type === 'thread' && msg.conversationId === conversationId) ||
      (msg.type === 'sent' && msg.conversationId === conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId)
  )
  const err = lastOfType(frames, 'error')
  if (err) throw new Error(err.message)
}

export async function applyGoal(
  phone: PhoneClient,
  conversationId: string,
  action: 'set' | 'pause' | 'resume' | 'clear',
  objective?: string
): Promise<Extract<RemoteServerMessage, { type: 'goaled' }>> {
  phone.send({
    type: 'goal',
    conversationId,
    action,
    ...(objective ? { objective } : {})
  })
  const frames = await phone.waitNew(
    (msg) =>
      (msg.type === 'goaled' && msg.conversationId === conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId)
  )
  const err = lastOfType(frames, 'error')
  if (err) throw new Error(err.message)
  const row = lastOfType(frames, 'goaled')
  if (!row) throw new Error('goal failed')
  return row
}

export async function locateWorkspace(
  phone: PhoneClient,
  conversationId: string,
  destinationDir: string
): Promise<Extract<RemoteServerMessage, { type: 'located' }>> {
  if (!destinationDir.trim()) throw new Error('vav-board session locate <id> <dir>')
  phone.send({ type: 'locate', conversationId, destinationDir })
  const frames = await phone.waitNew(
    (msg) =>
      (msg.type === 'located' && msg.conversationId === conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId)
  )
  const err = lastOfType(frames, 'error')
  if (err) throw new Error(err.message)
  const row = lastOfType(frames, 'located')
  if (!row) throw new Error('locate failed')
  return row
}

export async function deleteMessage(
  phone: PhoneClient,
  conversationId: string,
  messageId: string
): Promise<void> {
  if (!messageId) throw new Error('message id required')
  phone.send({ type: 'delete-message', conversationId, messageId })
  const frames = await phone.waitNew(
    (msg) =>
      (msg.type === 'thread' && msg.conversationId === conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId)
  )
  const err = lastOfType(frames, 'error')
  if (err) throw new Error(err.message)
}

export async function setLeaf(
  phone: PhoneClient,
  conversationId: string,
  messageId: string,
  follow = false
): Promise<void> {
  if (!messageId) throw new Error('message id required')
  phone.send({ type: 'leaf', conversationId, messageId, ...(follow ? { follow: true } : {}) })
  const frames = await phone.waitNew(
    (msg) =>
      (msg.type === 'thread' && msg.conversationId === conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId)
  )
  const err = lastOfType(frames, 'error')
  if (err) throw new Error(err.message)
}

export async function reviewSession(
  phone: PhoneClient,
  conversationId: string,
  action: 'active' | 'get' | 'accept-all' | 'reject-all',
  setId?: string
): Promise<Extract<RemoteServerMessage, { type: 'reviewed' }>> {
  phone.send({
    type: 'review',
    conversationId,
    action,
    ...(setId ? { setId } : {})
  })
  const frames = await phone.waitNew(
    (msg) =>
      (msg.type === 'reviewed' && msg.conversationId === conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId)
  )
  const err = lastOfType(frames, 'error')
  if (err) throw new Error(err.message)
  const row = lastOfType(frames, 'reviewed')
  if (!row) throw new Error('review failed')
  return row
}

export async function compactSession(
  phone: PhoneClient,
  conversationId: string,
  keepAfterMessageId?: string
): Promise<Extract<RemoteServerMessage, { type: 'compacted' }>> {
  phone.send({
    type: 'compact',
    conversationId,
    ...(keepAfterMessageId ? { keepAfterMessageId } : {})
  })
  const frames = await phone.waitNew(
    (msg) =>
      (msg.type === 'compacted' && msg.conversationId === conversationId) ||
      (msg.type === 'error' && msg.conversationId === conversationId),
    30_000
  )
  const err = lastOfType(frames, 'error')
  if (err) throw new Error(err.message)
  const compacted = lastOfType(frames, 'compacted')
  if (!compacted) throw new Error('compact failed')
  return compacted
}

export async function sendTurn(
  phone: PhoneClient,
  conversationId: string,
  text: string,
  timeoutMs = 120_000
): Promise<RemoteTurnEvent> {
  if (!text.trim()) throw new Error('empty prompt')
  phone.send({ type: 'send', conversationId, text })
  const frames = await phone.waitNew(
    (msg) =>
      isTurnSettled(msg, conversationId) || (msg.type === 'error' && msg.conversationId === conversationId),
    timeoutMs
  )
  const err = frames.findLast((msg) => msg.type === 'error' && msg.conversationId === conversationId)
  if (err && err.type === 'error') throw new Error(err.message)
  const done = frames.findLast((msg) => isTurnSettled(msg, conversationId))
  if (!done || done.type !== 'turn') throw new Error('turn did not finish')
  return done
}

export async function waitSessionStatus(
  phone: PhoneClient,
  conversationId: string,
  until: Array<RemoteSession['status']> = ['idle', 'done'],
  timeoutMs = 120_000
): Promise<RemoteSession> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const sessions = await listSessions(phone)
    const row = sessions.find((session) => session.id === conversationId)
    if (!row) throw new Error(`session not found: ${conversationId}`)
    if (until.includes(row.status)) return row
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`timeout waiting for ${until.join('|')}`)
}

export function resolveSession(
  sessions: RemoteSession[],
  idOrPrefix: string | undefined,
  fallback: 'create' | 'last' | 'none' = 'none'
): RemoteSession | null {
  if (idOrPrefix) {
    const exact = sessions.find((session) => session.id === idOrPrefix)
    if (exact) return exact
    const matches = sessions.filter(
      (session) => session.id.startsWith(idOrPrefix) || session.title === idOrPrefix
    )
    if (matches.length === 1) return matches[0]!
    if (matches.length > 1) throw new Error(`ambiguous session: ${idOrPrefix}`)
    throw new Error(`session not found: ${idOrPrefix}`)
  }
  if (fallback === 'last') {
    return (
      [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
    )
  }
  return null
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export function printLine(value: string): void {
  process.stdout.write(`${value}\n`)
}
