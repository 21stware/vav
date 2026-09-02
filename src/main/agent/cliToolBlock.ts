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
