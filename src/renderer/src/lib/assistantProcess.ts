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
  if (block.tool === 'request' || block.tool === 'ask_user_question') return false
  if (block.status === 'executing' || block.status === 'pending') return false
  if (block.children?.some((child) => isVisibleAssistantBlock(child))) return false
  if (block.output.trim()) return false
  const summary = block.summary.trim()
  if (!summary || RAW_TOOL_SUMMARY.test(summary)) return true
  return false
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
 * the last think sits next to the result every turn. Trailing reasoning after
 * the answer is peeled back into the process. No concluding text → ungrouped.
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
  peelTrailingReasoning(process, conclusion)

  if (process.length === 0 || conclusion.length === 0) {
    return { process: [], conclusion: visible }
  }

  return { process, conclusion }
}

/** Move leftover think after the answer back onto the process trail. */
function peelTrailingReasoning(process: IndexedBlock[], conclusion: IndexedBlock[]): void {
  let end = conclusion.length
  while (end > 0 && conclusion[end - 1]!.block.kind === 'reasoning') end--
  if (end === conclusion.length) return
  process.push(...conclusion.splice(end))
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
    process: visible.slice(0, -1),
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
