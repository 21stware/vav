import { randomUUID } from 'node:crypto'
import type { ChatMessage, ToolCallBlock, TurnEvent } from '../../shared/types.ts'

export type E2eStubSink = {
  emit: (event: TurnEvent) => void
  append: (message: ChatMessage) => void
}

export const E2E_STUB_ASK_ID = 'e2e-live-ask'
export const E2E_STUB_APPROVE_ID = 'e2e-live-approve'
export const E2E_STUB_STREAM_READ_ID = 'e2e-stream-read'

export function e2eStubReplyMessage(
  parentId: string | null,
  text = 'e2e stub reply',
  id = randomUUID(),
  createdAt = Date.now()
): ChatMessage {
  return {
    id,
    parentId,
    role: 'assistant',
    content: text,
    blocks: [{ kind: 'text', text }],
    createdAt
  }
}

export function e2eStubAskBlock(): ToolCallBlock {
  return {
    kind: 'toolCall',
    id: E2E_STUB_ASK_ID,
    tool: 'ask_user_question',
    summary: 'Pick a next step',
    input: JSON.stringify({
      question: 'Pick a next step',
      choices: ['Keep writing', 'Open review']
    }),
    output: '',
    status: 'pending',
    questions: [{ question: 'Pick a next step', choices: ['Keep writing', 'Open review'] }]
  }
}

export function e2eStubApproveBlock(): ToolCallBlock {
  return {
    kind: 'toolCall',
    id: E2E_STUB_APPROVE_ID,
    tool: 'fs_write',
    summary: 'Write hello.md',
    input: JSON.stringify({ path: 'hello.md', contents: 'patched\n' }),
    output: '',
    status: 'pending',
    choices: ['Approve', 'Deny']
  }
}

export function e2eApproveIsApproved(text: string): boolean {
  return /approve/i.test(text)
}

/** Playwright-only: finish a turn without calling a provider. */
export function completeE2eStubTurn(
  sink: E2eStubSink,
  conversationId: string,
  parentId: string | null
): void {
  const message = e2eStubReplyMessage(parentId)
  sink.emit({ type: 'start', conversationId })
  sink.append(message)
  sink.emit({ type: 'end', conversationId, message, tokensUsed: 0 })
}

/** Live reasoning + tool + text so StreamingMessage / StreamStatus can be asserted. */
export function startE2eStubStream(
  sink: E2eStubSink,
  conversationId: string,
  parentId: string | null
): void {
  const read: ToolCallBlock = {
    kind: 'toolCall',
    id: E2E_STUB_STREAM_READ_ID,
    tool: 'fs_read',
    summary: 'hello.md',
    input: JSON.stringify({ path: 'hello.md' }),
    output: '',
    status: 'executing'
  }
  const done: ToolCallBlock = { ...read, status: 'completed', output: '# hello from e2e\n' }
  const text = 'e2e stub reply'
  const message: ChatMessage = {
    id: randomUUID(),
    parentId,
    role: 'assistant',
    content: text,
    createdAt: Date.now(),
    blocks: [
      { kind: 'reasoning', text: 'e2e live thought', durationMs: 80 },
      done,
      { kind: 'text', text }
    ]
  }

  sink.emit({ type: 'start', conversationId })
  sink.emit({ type: 'phase', conversationId, phase: 'thinking' })
  sink.emit({
    type: 'delta',
    conversationId,
    index: 0,
    kind: 'reasoning',
    text: 'e2e live thought'
  })

  setTimeout(() => {
    sink.emit({ type: 'phase', conversationId, phase: 'working' })
    sink.emit({ type: 'tool', conversationId, index: 1, block: read })
  }, 160)

  setTimeout(() => {
    sink.emit({ type: 'tool', conversationId, index: 1, block: done })
    sink.emit({ type: 'phase', conversationId, phase: 'outputting' })
    sink.emit({
      type: 'delta',
      conversationId,
      index: 2,
      kind: 'text',
      text
    })
  }, 420)

  setTimeout(() => {
    sink.append(message)
    sink.emit({ type: 'end', conversationId, message, tokensUsed: 0 })
  }, 780)
}

/** Park on ask_user_question until the renderer answers the card. */
export function startE2eStubAsk(
  sink: E2eStubSink,
  waiters: Map<string, (text: string) => void>,
  conversationId: string,
  parentId: string | null
): void {
  const block = e2eStubAskBlock()
  sink.emit({ type: 'start', conversationId })
  sink.emit({ type: 'phase', conversationId, phase: 'awaiting-user' })
  sink.emit({
    type: 'awaiting',
    conversationId,
    toolCallId: block.id,
    index: 0,
    block
  })
  waiters.set(block.id, (text) => {
    const sealed: ToolCallBlock = { ...block, status: 'completed', output: text }
    const reply = `e2e stub reply · ${text}`
    const message: ChatMessage = {
      id: randomUUID(),
      parentId,
      role: 'assistant',
      content: reply,
      createdAt: Date.now(),
      blocks: [sealed, { kind: 'text', text: reply }]
    }
    sink.emit({ type: 'tool', conversationId, index: 0, block: sealed })
    sink.append(message)
    sink.emit({ type: 'end', conversationId, message, tokensUsed: 0 })
  })
}

/** Park on an Approve/Deny write gate until the renderer answers. */
export function startE2eStubApprove(
  sink: E2eStubSink,
  waiters: Map<string, (text: string) => void>,
  conversationId: string,
  parentId: string | null,
  persist?: () => Promise<void>
): void {
  const block = e2eStubApproveBlock()
  sink.emit({ type: 'start', conversationId })
  sink.emit({ type: 'phase', conversationId, phase: 'awaiting-user' })
  sink.emit({
    type: 'awaiting',
    conversationId,
    toolCallId: block.id,
    index: 0,
    block
  })
  const finish = (text: string, approved: boolean): void => {
    const sealed: ToolCallBlock = {
      ...block,
      status: approved ? 'completed' : 'skipped',
      output: text,
      choices: undefined
    }
    delete sealed.choices
    const reply = approved ? 'e2e stub reply · approved' : 'e2e stub reply · denied'
    const message: ChatMessage = {
      id: randomUUID(),
      parentId,
      role: 'assistant',
      content: reply,
      createdAt: Date.now(),
      blocks: [sealed, { kind: 'text', text: reply }]
    }
    sink.emit({ type: 'tool', conversationId, index: 0, block: sealed })
    sink.append(message)
    sink.emit({ type: 'end', conversationId, message, tokensUsed: 0 })
  }
  waiters.set(block.id, (text) => {
    const approved = e2eApproveIsApproved(text)
    if (approved && persist) {
      void persist().then(() => finish(text, true))
      return
    }
    finish(text, approved)
  })
}
