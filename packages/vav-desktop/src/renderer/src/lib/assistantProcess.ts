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

/**
 * Split a finished assistant turn into the working trail and the last answer.
 *
 * After the last tool, first trailing text is the conclusion. With no tools,
 * first text is the answer and leading reasoning is the process — otherwise
 * the last think sits next to the result every turn. Reasoning after or
 * between answer texts is peeled back onto the process in stream order.
 * No concluding text → ungrouped.
 */
export function splitAssistantProcess(blocks: MessageBlock[]): {
  process: IndexedBlock[]
  conclusion: IndexedBlock[]
} {
  const visible: IndexedBlock[] = []
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!
    if (isVisibleAssistantBlock(block)) visible.push({ block, index })
  }

  const lastTool = lastWhere(visible, (item) => item.block.kind === 'toolCall')
  const lastText = lastWhere(
    visible,
    (item) => item.block.kind === 'text' && item.block.text.trim().length > 0
  )
  if (lastText < 0) return { process: [], conclusion: visible }

  let cut = -1
  if (lastTool >= 0) {
    for (let i = lastTool + 1; i < visible.length; i++) {
      const item = visible[i]!
      if (item.block.kind === 'text' && item.block.text.trim()) {
        cut = i
        break
      }
    }
    if (cut < 0) return { process: [], conclusion: visible }
  } else {
    for (let i = 0; i < visible.length; i++) {
      const item = visible[i]!
      if (item.block.kind === 'text' && item.block.text.trim()) {
        cut = i
        break
      }
    }
  }
  if (cut < 0) return { process: [], conclusion: visible }

  const process = visible.slice(0, cut)
  const conclusion = visible.slice(cut)
  peelReasoningFromConclusion(process, conclusion)

  if (process.length === 0 || conclusion.length === 0) {
    return { process: [], conclusion: visible }
  }

  return { process: prepareProcessSteps(process), conclusion }
}

/**
 * Thinking belongs on the process trail, including leftover think after the
 * answer and think that landed between two answer texts. Leaving it in the
 * conclusion reprints it next to the result and in the wrong order.
 */
function peelReasoningFromConclusion(process: IndexedBlock[], conclusion: IndexedBlock[]): void {
  const kept: IndexedBlock[] = []
  const moved: IndexedBlock[] = []
  for (const item of conclusion) {
    if (item.block.kind === 'reasoning') moved.push(item)
    else kept.push(item)
  }
  if (moved.length === 0) return
  process.push(...moved)
  process.sort((a, b) => a.index - b.index)
  conclusion.length = 0
  conclusion.push(...kept)
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
 * Live split: collapse as soon as the likely answer starts — first text after
 * the last tool, or first text after leading think when there are no tools.
 * If another tool follows, keep the earlier trail folded and leave only the
 * in-flight tail visible so the process does not spring back open.
 */
export function splitLiveAssistantProcess(blocks: MessageBlock[]): {
  process: IndexedBlock[]
  live: IndexedBlock[]
} {
  const finished = splitAssistantProcess(blocks)
  if (finished.process.length > 0) {
    return { process: finished.process, live: finished.conclusion }
  }

  const visible: IndexedBlock[] = []
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!
    if (isVisibleAssistantBlock(block)) visible.push({ block, index })
  }
  if (visible.length < 2) return { process: [], live: visible }

  const hadTextAfterATool = visible.some((item, i) => {
    if (item.block.kind !== 'text' || !item.block.text.trim()) return false
    return visible.slice(0, i).some((prior) => prior.block.kind === 'toolCall')
  })
  if (!hadTextAfterATool) return { process: [], live: visible }

  return {
    process: prepareProcessSteps(visible.slice(0, -1)),
    live: visible.slice(-1)
  }
}

function lastWhere(items: IndexedBlock[], test: (item: IndexedBlock) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (test(items[i]!)) return i
  }
  return -1
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
