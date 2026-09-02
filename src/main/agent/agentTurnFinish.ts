import type { ChatMessage, MessageBlock } from '../../shared/types.ts'

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
