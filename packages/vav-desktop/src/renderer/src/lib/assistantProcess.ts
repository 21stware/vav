import { coalesceStreamChunk, foldSnapshotText } from '@shared/streamCoalesce'
import type { MessageBlock, ToolCallBlock } from '@shared/types'

export interface IndexedBlock {
  block: MessageBlock
  index: number
}

const RAW_TOOL_SUMMARY = /^(task|subtask|tool|external)$/i

/**
 * A tool card with nothing the user can recognize — no label, no output, no
 * nested work. These render as a blank sunken pill and should not split the
 * turn into a Thinking process.
 */
export function isHollowToolCard(block: ToolCallBlock): boolean {
  if (block.tool === 'plan') return true
  if (block.tool === 'plan_doc') return false
  if (
    block.tool === 'request' ||
    block.tool === 'ask_user_question' ||
    block.tool === 'request_for_secret'
  ) {
    return false
  }
  if (block.status === 'executing' || block.status === 'pending') return false
  if (block.children?.some((child) => isVisibleAssistantBlock(child))) return false
  if (block.output.trim()) return false
  const summary = block.summary.trim()
  if (!summary || RAW_TOOL_SUMMARY.test(summary)) return true
  return false
}

const EMPTY_TOOL_OUTPUT = /^(?:\{\}|\[\]|\(no output\)|（无输出）)$/i

/** Something the user can open: a body, hits, a nested transcript — not just args. */
export function hasToolResult(block: ToolCallBlock): boolean {
  if (block.children?.some((child) => isVisibleAssistantBlock(child))) return true
  const output = block.output.trim()
  if (!output || EMPTY_TOOL_OUTPUT.test(output)) return false
  return true
}

export function isVisibleAssistantBlock(block: MessageBlock): boolean {
  if (block.kind === 'plan') return false
  if (block.kind === 'toolCall') {
    if (block.tool === 'plan') return false
    if (isHollowToolCard(block)) return false
    return true
  }
  if (block.kind === 'text') return block.text.trim().length > 0
  if (block.kind === 'reasoning') return block.text.trim().length > 0
  return true
}

export type AssistantSegment =
  | { kind: 'thinking'; items: IndexedBlock[] }
  | { kind: 'text'; item: IndexedBlock }
  | { kind: 'tool'; item: IndexedBlock }

function visibleAssistantItems(blocks: MessageBlock[]): IndexedBlock[] {
  const visible: IndexedBlock[] = []
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!
    if (isVisibleAssistantBlock(block)) visible.push({ block, index })
  }
  return visible
}

/**
 * Keep thinking, tools, and answer text in stream order.
 *
 * Models often interleave reasoning with prose (think → answer → think →
 * more answer). Folding every think into one well at the top reprints that
 * trail out of order and hides the body that landed between thoughts.
 */
export function segmentAssistantTurn(blocks: MessageBlock[]): AssistantSegment[] {
  const out: AssistantSegment[] = []
  let thinking: IndexedBlock[] = []

  const flushThinking = (): void => {
    if (thinking.length === 0) return
    out.push({ kind: 'thinking', items: prepareProcessSteps(thinking) })
    thinking = []
  }

  for (const item of visibleAssistantItems(blocks)) {
    if (item.block.kind === 'reasoning') {
      thinking.push(item)
      continue
    }
    flushThinking()
    if (item.block.kind === 'toolCall') out.push({ kind: 'tool', item })
    else if (item.block.kind === 'text') out.push({ kind: 'text', item })
  }
  flushThinking()
  return out
}

/**
 * Flat split for callers that only need "any think" vs "everything else".
 * Rendering should use {@link segmentAssistantTurn} so interleaved think and
 * body stay in stream order.
 */
export function splitAssistantProcess(blocks: MessageBlock[]): {
  process: IndexedBlock[]
  conclusion: IndexedBlock[]
} {
  const segments = segmentAssistantTurn(blocks)
  const process: IndexedBlock[] = []
  const conclusion: IndexedBlock[] = []
  for (const segment of segments) {
    if (segment.kind === 'thinking') process.push(...segment.items)
    else conclusion.push(segment.item)
  }
  if (process.length === 0 || conclusion.length === 0) {
    return { process: [], conclusion: visibleAssistantItems(blocks) }
  }
  return { process, conclusion }
}

/**
 * Sealed-turn split. Same groups as {@link splitAssistantProcess}, except an
 * incomplete trail (Stop mid-think, or a turn that ended on a tool) stays
 * collected instead of flattening into a bare conclusion.
 */
export function splitSealedAssistantProcess(blocks: MessageBlock[]): {
  process: IndexedBlock[]
  conclusion: IndexedBlock[]
} {
  const split = splitAssistantProcess(blocks)
  if (split.process.length > 0) return split
  const hasTrail = split.conclusion.some(
    (item) => item.block.kind === 'reasoning' || item.block.kind === 'toolCall'
  )
  if (!hasTrail) return split
  return { process: prepareProcessSteps(split.conclusion), conclusion: [] }
}

/** Fold snapshot reprints and keep steps in stream order. */
export function prepareProcessSteps(items: IndexedBlock[]): IndexedBlock[] {
  const out: IndexedBlock[] = []
  for (const item of items) {
    const block =
      item.block.kind === 'reasoning' || item.block.kind === 'text'
        ? { ...item.block, text: foldSnapshotText(item.block.text) }
        : item.block
    const prev = out[out.length - 1]
    if (
      prev &&
      (block.kind === 'reasoning' || block.kind === 'text') &&
      prev.block.kind === block.kind
    ) {
      const prevText =
        prev.block.kind === 'reasoning' || prev.block.kind === 'text' ? prev.block.text : ''
      const merged = coalesceStreamChunk(prevText, block.text)
      if (merged === prevText) continue
      if (merged !== prevText + block.text) {
        out[out.length - 1] = { index: item.index, block: { ...block, text: merged } }
        continue
      }
    }
    out.push({ index: item.index, block })
  }
  return out
}

/**
 * Live split derived from {@link segmentAssistantTurn}. Prefer the segments
 * themselves so later think can land after body text that already started.
 */
export function splitLiveAssistantProcess(blocks: MessageBlock[]): {
  process: IndexedBlock[]
  live: IndexedBlock[]
} {
  const finished = splitAssistantProcess(blocks)
  if (finished.process.length > 0) {
    return { process: finished.process, live: finished.conclusion }
  }
  return { process: [], live: visibleAssistantItems(blocks) }
}

/** First line of interstitial narration, for a collapsed process row. */
export function previewProcessText(source: string, max = 72): string {
  const line = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`_~\[\]]/g, '')
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean)
  if (!line) return ''
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`
}

/** Sum sealed reasoning durations on the process trail. */
export function processThoughtMs(items: IndexedBlock[]): number | undefined {
  let total = 0
  let any = false
  for (const item of items) {
    if (item.block.kind !== 'reasoning') continue
    if (item.block.durationMs == null) continue
    total += item.block.durationMs
    any = true
  }
  return any ? total : undefined
}
