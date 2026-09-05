import type { ChatMessage, MessageBlock, TurnRecovery, TurnStatus } from '../../shared/types.ts'

/** pi stopReason on the final assistant message. */
export function assistantStopKind(
  stopReason: string | undefined
): 'cancelled' | 'error' | null {
  if (stopReason === 'aborted') return 'cancelled'
  if (stopReason === 'error') return 'error'
  return null
}

/** Skip toolcall deltas that only grow contents after the card summary is known. */
export function skipStableToolcallDelta(
  eventType: string,
  prev: { summary: string } | null,
  summary: string
): boolean {
  return eventType === 'toolcall_delta' && !!prev && prev.summary === summary
}

/** Stable map key for one `(llm turn, contentIndex)` stream slot. */
export function streamSlotKey(llmTurn: number, contentIndex: number): string {
  return `${llmTurn}:${contentIndex}`
}

export type StreamSlotTurn = {
  llmTurn: number
  slots: Map<string, number>
  blocks: MessageBlock[]
  reasoningStartedAt: Map<number, number>
}

/**
 * Allocate or reuse the block index for one stream slot. Seals open reasoning
 * before a non-reasoning seed, and stamps reasoning start on a new think slot.
 */
export function allocateStreamSlot(
  turn: StreamSlotTurn,
  contentIndex: number,
  seed: MessageBlock,
  sealNonReasoning: () => void,
  now = Date.now()
): number {
  const key = streamSlotKey(turn.llmTurn, contentIndex)
  const existing = turn.slots.get(key)
  if (existing !== undefined) return existing
  if (seed.kind !== 'reasoning') sealNonReasoning()
  const slot = turn.blocks.length
  turn.blocks.push(seed)
  turn.slots.set(key, slot)
  if (seed.kind === 'reasoning') turn.reasoningStartedAt.set(slot, now)
  return slot
}

export type ToolAnswerRoute = 'e2e' | 'preferred' | 'scan' | 'sole' | 'none'

/**
 * Route a card answer: e2e waiter → preferred turn → scan by toolCallId →
 * sole parked waiter. Resolve/mutate stays in the runtime.
 */
export function pickToolAnswerRoute(opts: {
  hasE2eWaiter: boolean
  preferredHasTool: boolean
  scanHasTool: boolean
  soleWaiterCount: number
}): ToolAnswerRoute {
  if (opts.hasE2eWaiter) return 'e2e'
  if (opts.preferredHasTool) return 'preferred'
  if (opts.scanHasTool) return 'scan'
  if (opts.soleWaiterCount === 1) return 'sole'
  return 'none'
}

export function findTurnWithPendingTool<T>(
  turns: Iterable<T>,
  hasTool: (turn: T) => boolean
): T | undefined {
  for (const turn of turns) {
    if (hasTool(turn)) return turn
  }
  return undefined
}

export function collectParkedWaiters<T>(
  turns: Iterable<{ pending: Map<string, T> }>
): T[] {
  const out: T[] = []
  for (const turn of turns) {
    for (const waiter of turn.pending.values()) out.push(waiter)
  }
  return out
}

/** Drop empty text/reasoning slots that opened before any token landed. */
export function persistableTurnBlocks(blocks: MessageBlock[]): MessageBlock[] {
  return blocks.filter(
    (b) =>
      b.kind === 'toolCall' ||
      b.kind === 'plan' ||
      (b.kind === 'text' && b.text.length > 0) ||
      (b.kind === 'reasoning' && b.text.length > 0)
  )
}

export function assistantSnapshotFromTurn(
  turn: { messageId: string; parentId: string | null; blocks: MessageBlock[] },
  extra: Partial<ChatMessage> = {},
  now = Date.now()
): ChatMessage {
  const blocks = persistableTurnBlocks(turn.blocks)
  return {
    id: turn.messageId,
    parentId: turn.parentId,
    role: 'assistant',
    content: blocks
      .filter((b): b is Extract<MessageBlock, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n'),
    blocks: blocks.map((b) => ({ ...b })),
    createdAt: now,
    ...extra
  }
}

/** Ask/request stay skipped; other in-flight tools expire. Plan is sealed separately. */
export function sealCancelledInteractiveTools(blocks: MessageBlock[], cancelledLabel: string): void {
  for (const block of blocks) {
    if (block.kind !== 'toolCall') continue
    if (block.tool === 'plan') continue
    if (
      (block.tool === 'ask_user_question' || block.tool === 'request') &&
      block.status === 'pending'
    ) {
      block.status = 'skipped'
      block.output = cancelledLabel
      continue
    }
    if (block.status === 'pending' || block.status === 'executing') {
      block.status = 'expired'
    }
  }
}

export function appendTurnErrorBlock(blocks: MessageBlock[], error: string): void {
  blocks.push({
    kind: 'text',
    text: blocks.length ? `\n\n> ${error}` : `> ${error}`
  })
}

/** Idle / in-flight TurnStatus for a late-joining window (sparse blocks stay). */
export function runtimeTurnStatus(
  conversationId: string,
  turn:
    | {
        phase: TurnStatus['phase']
        toolCount: number
        pending: { keys(): IterableIterator<string> }
        messageId: string | null
        blocks: MessageBlock[]
        recovery?: TurnRecovery | null
      }
    | undefined
): TurnStatus {
  return {
    conversationId,
    isRunning: !!turn,
    phase: turn?.phase ?? 'idle',
    toolCount: turn?.toolCount ?? 0,
    awaitingToolCallId: turn ? (turn.pending.keys().next().value ?? null) : null,
    messageId: turn?.messageId ?? null,
    blocks: turn ? turn.blocks.map((block) => ({ ...block })) : [],
    recovery: turn?.recovery ?? null
  }
}

/** Cancelled turns drop the error and expire in-flight tools; errors stay as a quote. */
export function applyRuntimeFinishSeals(
  turn: { cancelled?: boolean; error?: string; blocks: MessageBlock[] },
  cancelledLabel: string
): void {
  if (turn.cancelled) {
    turn.error = undefined
    sealCancelledInteractiveTools(turn.blocks, cancelledLabel)
  }
  if (turn.error) appendTurnErrorBlock(turn.blocks, turn.error)
}

/** Empty cancelled turns with no change set never become a transcript leaf. */
export function shouldPersistAssistantTurn(message: {
  blocks: unknown[]
  changeSetId?: string
}): boolean {
  return message.blocks.length > 0 || !!message.changeSetId
}

export type NoticeAppendPlan = 'drop' | 'queue' | 'write'

/** Running turns queue Discard-style notices so they land after the assistant leaf. */
export function noticeAppendPlan(opts: {
  body: string
  conversationExists: boolean
  isRunning: boolean
}): NoticeAppendPlan {
  if (!opts.body || !opts.conversationExists) return 'drop'
  if (opts.isRunning) return 'queue'
  return 'write'
}

export function enqueuePendingNotice(
  pending: Map<string, string[]>,
  conversationId: string,
  body: string
): void {
  const queue = pending.get(conversationId) ?? []
  queue.push(body)
  pending.set(conversationId, queue)
}
