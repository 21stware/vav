import type { ChatMessage, PreviewRef, QuoteDraft } from '../../shared/types.ts'

/** Clear changeSetId on older messages when a new turn begins. Returns whether any were dirty. */
export function stripChangeSetIds(messages: Array<{ changeSetId?: string }>): boolean {
  let dirty = false
  for (const message of messages) {
    if (!message.changeSetId) continue
    delete message.changeSetId
    dirty = true
  }
  return dirty
}

export function isAssistant<T>(message: T): message is T & { role: 'assistant' } {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { role?: unknown }).role === 'assistant'
  )
}

/** Fallback card text for results pi synthesised itself (blocked, not found). */
export function textOf(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  return content
    .filter((part): part is { type: 'text'; text: string } => part?.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

export function userTurnMessage(opts: {
  id: string
  parentId: string | null
  text: string
  createdAt?: number
  quote?: QuoteDraft | null
  contextBlocks?: PreviewRef[] | null
  attachments?: string[] | null
  contextFile?: string | null
}): ChatMessage {
  const quote = opts.quote
  const contextBlocks = opts.contextBlocks
  const attachments = opts.attachments
  return {
    id: opts.id,
    parentId: opts.parentId,
    role: 'user',
    content: opts.text,
    blocks: [{ kind: 'text', text: opts.text }],
    createdAt: opts.createdAt ?? Date.now(),
    ...(quote
      ? {
          quoteMessageId: quote.messageId,
          quoteSummary: quote.summary,
          quoteRole: quote.role
        }
      : {}),
    ...(contextBlocks && contextBlocks.length ? { contextBlocks } : {}),
    ...(attachments && attachments.length ? { attachments: [...attachments] } : {}),
    ...(opts.contextFile ? { contextFile: opts.contextFile } : {})
  }
}

/** Sidebar notice the model should see on the next send. */
export function systemNoticeMessage(opts: {
  id: string
  parentId: string | null
  body: string
  createdAt?: number
}): ChatMessage {
  return {
    id: opts.id,
    parentId: opts.parentId,
    role: 'system',
    content: opts.body,
    blocks: [{ kind: 'text', text: opts.body }],
    createdAt: opts.createdAt ?? Date.now()
  }
}

/** Terminal failure for a turn that never started (missing key, empty history). */
export function fatalAssistantMessage(opts: {
  id: string
  parentId: string | null
  error: string
  createdAt?: number
}): ChatMessage {
  return {
    id: opts.id,
    parentId: opts.parentId,
    role: 'assistant',
    content: opts.error,
    blocks: [{ kind: 'text', text: `> ${opts.error}` }],
    createdAt: opts.createdAt ?? Date.now(),
    errorText: opts.error,
    errorDetail: opts.error
  }
}
