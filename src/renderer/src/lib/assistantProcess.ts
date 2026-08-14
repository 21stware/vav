import type { MessageBlock } from '@shared/types'

export interface IndexedBlock {
  block: MessageBlock
  index: number
}

export function isVisibleAssistantBlock(block: MessageBlock): boolean {
  if (block.kind === 'plan') return false
  if (block.kind === 'toolCall' && block.tool === 'plan') return false
  if (block.kind === 'text') return block.text.trim().length > 0
  if (block.kind === 'reasoning') return block.text.trim().length > 0
  return true
}

/**
 * Split a finished assistant turn into the working trail and the last answer.
 *
 * Providers VAV actually drives (DeepSeek / Claude Messages / OpenAI
 * Completions) do not tag commentary vs. final_answer. After the last tool,
 * trailing text is the conclusion; everything before it is the process.
 * No tools, or no text after the last tool → leave the turn ungrouped.
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
  if (lastTool < 0) return { process: [], conclusion: visible }

  let cut = -1
  for (let i = lastTool + 1; i < visible.length; i++) {
    const item = visible[i]!
    if (item.block.kind === 'text' && item.block.text.trim()) {
      cut = i
      break
    }
  }
  if (cut <= 0) return { process: [], conclusion: visible }

  return {
    process: visible.slice(0, cut),
    conclusion: visible.slice(cut)
  }
}

/**
 * Live split: collapse as soon as post-tool text starts (the likely answer).
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
