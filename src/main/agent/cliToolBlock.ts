import type { MessageBlock, ToolCallBlock, ToolCallStatus, ToolName } from '../../shared/types.ts'
import { findToolBlock } from '../../shared/subtask.ts'

export function newCliToolCallBlock(opts: {
  id: string
  tool: ToolName
  summary: string
  input: string
  status?: ToolCallStatus
  output?: string
  children?: MessageBlock[]
  questions?: ToolCallBlock['questions']
  askTitle?: string
  choices?: string[]
}): ToolCallBlock {
  const block: ToolCallBlock = {
    kind: 'toolCall',
    id: opts.id,
    tool: opts.tool,
    summary: opts.summary,
    input: opts.input,
    output: opts.output ?? '',
    status: opts.status ?? 'pending'
  }
  if (opts.children) block.children = opts.children
  if (opts.questions) block.questions = opts.questions
  if (opts.askTitle) block.askTitle = opts.askTitle
  if (opts.choices) block.choices = opts.choices
  return block
}

/** Permission card: Approve/Deny on `request`, id `perm-${requestId}`. */
export function newCliPermissionBlock(event: {
  requestId: string
  summary?: string
  toolName: string
  inputJson: string
}): ToolCallBlock {
  return newCliToolCallBlock({
    id: `perm-${event.requestId}`,
    tool: 'request',
    summary: event.summary || event.toolName,
    input: event.inputJson,
    choices: ['Approve', 'Deny'],
    askTitle: event.toolName
  })
}

/** Ask/plan-doc stay pending while the host streams updates. */
export function shouldKeepPendingInteractive(block: {
  status: string
  tool: string
}): boolean {
  return (
    block.status === 'pending' && (block.tool === 'plan_doc' || block.tool === 'ask_user_question')
  )
}

export function applyToolEventStatus(
  block: ToolCallBlock,
  status: string,
  output?: string
): void {
  if (status === 'started' || status === 'updated') {
    if (!shouldKeepPendingInteractive(block)) block.status = 'executing'
  } else if (status === 'completed') {
    block.status = 'completed'
    if (output != null) block.output = output
  } else if (status === 'error') {
    block.status = 'error'
    if (output != null) block.output = output
  }
}

/** Merge live tool-runtime state onto the transcript card, clearing approval UI. */
export function applyToolRuntimePatch(
  prev: ToolCallBlock,
  state: {
    status: ToolCallBlock['status']
    output?: string
    choices?: string[]
    multiSelect?: boolean
    questions?: ToolCallBlock['questions']
    askTitle?: string
  }
): ToolCallBlock {
  const block: ToolCallBlock = {
    ...prev,
    status: state.status,
    output: state.output ?? prev.output
  }
  if (!state.choices) {
    delete block.choices
    delete block.multiSelect
    delete block.questions
    delete block.askTitle
  } else {
    block.choices = state.choices
    if (state.multiSelect != null) block.multiSelect = state.multiSelect
    if (state.questions) block.questions = state.questions
    if (state.askTitle) block.askTitle = state.askTitle
  }
  return block
}

export function toolCallBlockIndex(
  blocks: Array<{ kind: string; id?: string }>,
  toolCallId: string
): number {
  return blocks.findIndex((b) => b.kind === 'toolCall' && b.id === toolCallId)
}

/** Explicit `undefined` on approval fields leaves the Approve/Deny UI. */
export function applyToolStatePatch<T extends { status: string; output?: string }>(
  prev: T,
  patch: Partial<T> & {
    choices?: unknown
    multiSelect?: unknown
    questions?: unknown
    askTitle?: unknown
  }
): T {
  Object.assign(prev, patch)
  if ('choices' in patch && patch.choices === undefined) delete (prev as { choices?: unknown }).choices
  if ('multiSelect' in patch && patch.multiSelect === undefined) {
    delete (prev as { multiSelect?: unknown }).multiSelect
  }
  if ('questions' in patch && patch.questions === undefined) {
    delete (prev as { questions?: unknown }).questions
  }
  if ('askTitle' in patch && patch.askTitle === undefined) delete (prev as { askTitle?: unknown }).askTitle
  return prev
}

/** Skip a card emit when the encoded payload did not change. */
export function rememberSentToolCard(
  sent: Map<string, string>,
  blockId: string,
  encoded: string
): boolean {
  if (sent.get(blockId) === encoded) return false
  sent.set(blockId, encoded)
  return true
}

export function cliToolHasInput(input: unknown): boolean {
  return !!input && typeof input === 'object' && Object.keys(input as object).length > 0
}

/** Keep a mapped `external` name only when the card is already `external`. */
export function shouldAdoptMappedTool(mapped: string, current: string): boolean {
  return mapped !== 'external' || current === 'external'
}

/** Title, then summarized args, then the raw host tool name. */
export function cliToolCardSummary(
  event: { title?: string; name: string; input?: unknown },
  summarize: (name: string, input: unknown) => string
): string {
  return event.title || summarize(event.name, event.input) || event.name
}

/** Merge a CLI driver tool event onto the live transcript card. */
export function applyCliToolPatch(
  block: ToolCallBlock,
  event: {
    status: string
    input?: unknown
    title?: string
    name: string
    output?: string
  },
  deps: {
    inputJson: (input: unknown) => string
    summarize: (name: string, input: unknown) => string
    mapToolName: (name: string) => ToolName
  }
): void {
  if (event.status === 'started' || event.status === 'updated') {
    applyToolEventStatus(block, event.status)
    if (cliToolHasInput(event.input)) {
      block.input = deps.inputJson(event.input)
      block.summary = event.title || deps.summarize(event.name, event.input) || event.name
      const mapped = deps.mapToolName(event.name)
      if (shouldAdoptMappedTool(mapped, block.tool)) block.tool = mapped
    } else if (event.title) {
      block.summary = event.title
    }
  } else if (event.status === 'completed' || event.status === 'error') {
    applyToolEventStatus(block, event.status, event.output ?? block.output)
  }
}

/** Append/concat nested text or reasoning onto a parent task's children. */
export function appendNestedChildDelta(
  children: MessageBlock[],
  kind: 'text' | 'reasoning',
  text: string
): boolean {
  if (!text) return false
  const last = children[children.length - 1]
  if (last && last.kind === kind) {
    last.text += text
  } else {
    children.push(kind === 'text' ? { kind: 'text', text } : { kind: 'reasoning', text })
  }
  return true
}

/** Guarantee a toolCall block so approval patches always reach the renderer. */
export function ensureToolCallBlock(
  blocks: MessageBlock[],
  toolCallId: string,
  summary: string
): boolean {
  if (toolCallBlockIndex(blocks, toolCallId) >= 0) return false
  blocks.push(
    newCliToolCallBlock({
      id: toolCallId,
      tool: 'terminal',
      summary: summary || toolCallId,
      input: '{}'
    })
  )
  return true
}

/** Parent task card that nested CLI children hang off. */
export function newCliParentTaskBlock(parentId: string, summary: string): ToolCallBlock {
  return newCliToolCallBlock({
    id: parentId,
    tool: 'task',
    summary,
    input: '{}',
    status: 'executing',
    children: []
  })
}

type CliParentTurn = {
  blocks: MessageBlock[]
  toolIndex: Map<string, number>
  textIndex: number | null
  reasoningIndex: number | null
}

/** Insert a parent task card if missing; seal open reasoning on first insert. */
export function ensureCliParentTask<T extends CliParentTurn>(
  turn: T,
  parentId: string,
  summary: string,
  sealOpenReasoning: (turn: T) => void
): ToolCallBlock {
  const existing = findToolBlock(turn.blocks, parentId)
  if (existing) return existing
  const block = newCliParentTaskBlock(parentId, summary)
  turn.toolIndex.set(parentId, turn.blocks.length)
  turn.blocks.push(block)
  sealOpenReasoning(turn)
  turn.textIndex = null
  turn.reasoningIndex = null
  return block
}
