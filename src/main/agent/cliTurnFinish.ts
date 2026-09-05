import { classifyCliError, splitStreamedRetriableError } from '../../shared/cliErrors.ts'
import type { ChatMessage, MessageBlock } from '../../shared/types.ts'

/** Cancelled turns skip the retry ladder and seal immediately. */
export function shouldSettleAsCancelled(
  cancelled: boolean,
  raw: string,
  code?: number | null
): boolean {
  return cancelled || classifyCliError(raw, null, code) === 'cancelled'
}

/**
 * Consume a queued Stop (or an already-stamped turn) so startTurn can seal
 * without talking to the driver.
 */
export function consumePendingCancel(
  pendingCancels: Set<string>,
  conversationId: string,
  turn: { cancelled: boolean }
): boolean {
  if (!pendingCancels.delete(conversationId) && !turn.cancelled) return false
  turn.cancelled = true
  return true
}

/** CLI transcripts join text blocks with a blank line and trim the result. */
export function cliAssistantContent(blocks: MessageBlock[]): string {
  return blocks
    .filter((b): b is Extract<MessageBlock, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text)
    .join('\n\n')
    .trim()
}

/**
 * Cancelled CLI turns drop the error unless classification is quota — those
 * stay as errors so the UI can show the limit instead of a cancelled turn.
 */
export function applyCliCancelQuota(turn: {
  cancelled: boolean
  error?: string
  errorKind?: unknown
  errorCode?: number | null
  errorDetail?: string
}): void {
  if (!turn.cancelled) return
  if (classifyCliError(turn.error || '', null, turn.errorCode) === 'quota') {
    turn.cancelled = false
    return
  }
  turn.error = undefined
  turn.errorKind = undefined
  turn.errorDetail = undefined
}

export function cliAssistantMessage(
  turn: {
    messageId: string
    parentId: string | null
    blocks: MessageBlock[]
    cancelled: boolean
    error?: string
    errorDetail?: string
  },
  now = Date.now()
): ChatMessage {
  return {
    id: turn.messageId,
    parentId: turn.parentId,
    role: 'assistant',
    content: cliAssistantContent(turn.blocks),
    blocks: turn.blocks.map((b) => ({ ...b })),
    createdAt: now,
    cancelled: turn.cancelled || undefined,
    errorText: turn.error,
    errorDetail: turn.errorDetail
  }
}

export type LeakedStreamStrip = {
  leaked: string | null
  replaceIndex: number | null
  replaceText: string | null
}

/**
 * cursor-agent ACP streams internal stream teardowns as a trailing text
 * chunk. Strip the leak in-place and tell the host which delta to replace.
 */
export function stripLeakedStreamErrorFromTurn(turn: {
  blocks: MessageBlock[]
  textIndex: number | null
}): LeakedStreamStrip {
  const last = turn.blocks[turn.blocks.length - 1]
  if (!last || last.kind !== 'text') {
    return { leaked: null, replaceIndex: null, replaceText: null }
  }
  const split = splitStreamedRetriableError(last.text)
  if (!split.leaked) return { leaked: null, replaceIndex: null, replaceText: null }
  const index = turn.blocks.length - 1
  if (split.text) {
    last.text = split.text
    return { leaked: split.leaked, replaceIndex: index, replaceText: split.text }
  }
  turn.blocks.pop()
  if (turn.textIndex != null && turn.textIndex >= turn.blocks.length) {
    turn.textIndex = null
  }
  return { leaked: split.leaked, replaceIndex: index, replaceText: '' }
}

/**
 * The whole streamed reply was a leaked internal error and the turn is
 * being retried: drop the polluted blocks so the retry streams onto a clean draft.
 */
export function clearCliTurnDraft(turn: {
  flushTimer: ReturnType<typeof setTimeout> | null
  blocks: unknown[]
  buffers: { clear(): void }
  textIndex: number | null
  reasoningIndex: number | null
  toolIndex: { clear(): void }
  toolCount: number
  reasoningStartedAt: { clear(): void }
  nestedDirty: { clear(): void }
}): void {
  if (turn.flushTimer) {
    clearTimeout(turn.flushTimer)
    turn.flushTimer = null
  }
  turn.blocks = []
  turn.buffers.clear()
  turn.textIndex = null
  turn.reasoningIndex = null
  turn.toolIndex.clear()
  turn.toolCount = 0
  turn.reasoningStartedAt.clear()
  turn.nestedDirty.clear()
}
