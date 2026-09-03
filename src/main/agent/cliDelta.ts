import type { MessageBlock } from '../../shared/types.ts'

export type CliDeltaTurn = {
  textIndex: number | null
  reasoningIndex: number | null
  blocks: MessageBlock[]
  reasoningStartedAt: Map<number, number>
  toolCount: number
}

/**
 * Open or reuse the live text/reasoning slot. New text after a tool starts a
 * fresh block so the reply does not glue onto the last card.
 */
export function allocateCliDeltaSlot(
  turn: CliDeltaTurn,
  kind: 'text' | 'reasoning',
  sealReasoning: () => void,
  now = Date.now()
): number {
  let index = kind === 'text' ? turn.textIndex : turn.reasoningIndex
  if (index == null) {
    if (kind === 'text') sealReasoning()
    index = turn.blocks.length
    turn.blocks.push(kind === 'text' ? { kind: 'text', text: '' } : { kind: 'reasoning', text: '' })
    if (kind === 'text') turn.textIndex = index
    else {
      turn.reasoningIndex = index
      turn.reasoningStartedAt.set(index, now)
    }
  }
  if (kind === 'text' && turn.toolCount > 0) {
    const last = turn.blocks[turn.blocks.length - 1]
    if (last && last.kind !== 'text') {
      index = turn.blocks.length
      turn.blocks.push({ kind: 'text', text: '' })
      turn.textIndex = index
    }
  }
  return index
}
