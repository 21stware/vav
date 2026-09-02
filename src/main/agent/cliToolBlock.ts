import type { MessageBlock, ToolCallBlock, ToolCallStatus, ToolName } from '../../shared/types.ts'

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

export function cliToolHasInput(input: unknown): boolean {
  return !!input && typeof input === 'object' && Object.keys(input as object).length > 0
}

/** Keep a mapped `external` name only when the card is already `external`. */
export function shouldAdoptMappedTool(mapped: string, current: string): boolean {
  return mapped !== 'external' || current === 'external'
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
