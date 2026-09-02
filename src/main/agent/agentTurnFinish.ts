import type { ChatMessage, MessageBlock, TurnStatus } from '../../shared/types.ts'

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
    blocks: turn ? turn.blocks.map((block) => ({ ...block })) : []
  }
}
