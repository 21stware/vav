import type { ToolCallBlock } from '@shared/types'
import type { IndexedBlock } from '../lib/assistantProcess'
import { ReasoningBlock } from './ReasoningBlock'
import { ToolCallGroup } from './ToolCallGroup'
import { ToolCard } from './ToolCard'

function flushToolRun(
  run: ToolCallBlock[],
  nodes: React.JSX.Element[]
): void {
  if (run.length === 0) return
  if (run.length === 1) {
    nodes.push(<ToolCard key={run[0]!.id} block={run[0]!} startCollapsed />)
    return
  }
  nodes.push(
    <ToolCallGroup
      key={`tools-${run[0]!.id}-${run[run.length - 1]!.id}`}
      blocks={[...run]}
    />
  )
}

/**
 * Reasoning and the tools that ran during it, in stream order, for the
 * thinking-process viewport.
 */
export function ThinkingSteps({
  items,
  resolveTool,
  live = false
}: {
  items: IndexedBlock[]
  resolveTool?: (index: number) => ToolCallBlock | null
  live?: boolean
}): React.JSX.Element {
  const nodes: React.JSX.Element[] = []
  const run: ToolCallBlock[] = []
  let lastReasoning = -1
  for (let i = 0; i < items.length; i++) {
    if (items[i]?.block.kind === 'reasoning') lastReasoning = i
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (item.block.kind === 'reasoning') {
      flushToolRun(run, nodes)
      run.length = 0
      nodes.push(
        <ReasoningBlock
          key={`r${item.index}`}
          text={item.block.text}
          flat
          live={live && i === lastReasoning}
        />
      )
      continue
    }
    if (item.block.kind !== 'toolCall') continue
    const block = resolveTool?.(item.index) ?? item.block
    if (block.kind !== 'toolCall') continue
    run.push(block)
  }
  flushToolRun(run, nodes)

  return <>{nodes}</>
}
