/**
 * ACP hosts (Grok in particular) replay the previous assistant turn as
 * session/update events at the start of the next session/prompt. Those events
 * must not be stored as the new transcript.
 *
 * Known tool ids are skipped outright. Text and reasoning are skipped only
 * while they reconstruct the previous assistant prefix; the first new tool id
 * or divergent chunk opens the live turn.
 */
import type { ChatMessage, MessageBlock } from '@shared/types'

export type ReplayDecision = 'skip' | 'take'

export class CliHistoryReplayGate {
  private live: boolean
  private skippedText = ''
  private skippedReasoning = ''
  private readonly priorToolIds: ReadonlySet<string>
  private readonly priorText: string
  private readonly priorReasoning: string

  constructor(priorToolIds: ReadonlySet<string>, priorText: string, priorReasoning: string) {
    this.priorToolIds = priorToolIds
    this.priorText = priorText
    this.priorReasoning = priorReasoning
    this.live = priorToolIds.size === 0 && !priorText && !priorReasoning
  }

  get isLive(): boolean {
    return this.live
  }

  /** Fresh session / no history to strip — record everything from here. */
  open(): void {
    this.live = true
  }

  isHistoricalTool(id: string, parentId?: string | null): boolean {
    if (this.live) return false
    return this.priorToolIds.has(id) || (!!parentId && this.priorToolIds.has(parentId))
  }

  tool(id: string, parentId?: string | null): ReplayDecision {
    if (this.live) return 'take'
    if (this.isHistoricalTool(id, parentId)) return 'skip'
    this.live = true
    return 'take'
  }

  text(chunk: string): ReplayDecision {
    return this.consume(chunk, 'text')
  }

  reasoning(chunk: string): ReplayDecision {
    return this.consume(chunk, 'reasoning')
  }

  private consume(chunk: string, kind: 'text' | 'reasoning'): ReplayDecision {
    if (this.live) return 'take'
    if (!chunk) return 'skip'
    const prior = kind === 'text' ? this.priorText : this.priorReasoning
    const skipped = kind === 'text' ? this.skippedText : this.skippedReasoning
    const next = skipped + chunk
    if (prior.startsWith(next)) {
      if (kind === 'text') this.skippedText = next
      else this.skippedReasoning = next
      return 'skip'
    }
    this.live = true
    return 'take'
  }
}

export function createCliHistoryReplayGate(
  messages: ChatMessage[]
): CliHistoryReplayGate {
  const priorToolIds = new Set<string>()
  let priorText = ''
  let priorReasoning = ''
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    collectToolIds(message.blocks, priorToolIds)
    priorText = concatKind(message.blocks, 'text')
    priorReasoning = concatKind(message.blocks, 'reasoning')
  }
  return new CliHistoryReplayGate(priorToolIds, priorText, priorReasoning)
}

function collectToolIds(blocks: MessageBlock[], into: Set<string>): void {
  for (const block of blocks) {
    if (block.kind !== 'toolCall') continue
    into.add(block.id)
    if (block.children?.length) collectToolIds(block.children, into)
  }
}

function concatKind(blocks: MessageBlock[], kind: 'text' | 'reasoning'): string {
  let out = ''
  for (const block of blocks) {
    if (block.kind === kind) out += block.text
    if (block.kind === 'toolCall' && block.children?.length) {
      out += concatKind(block.children, kind)
    }
  }
  return out
}
