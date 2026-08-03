/**
 * Translating between vav's stored transcript and pi's message types.
 *
 * vav stores one `ChatMessage` per assistant turn with an ordered `blocks`
 * array, because that is what the UI renders and what the message tree hangs
 * off. pi wants alternating `assistant` / `toolResult` messages. The split
 * happens here, at the boundary, so neither side has to know about the other's
 * shape.
 *
 * Only the active branch is ever sent: alternate versions of a reply are for
 * the reader, not the model.
 */
import type { Api, AssistantMessage, Message, Model, ToolCall } from '@earendil-works/pi-ai'
import { composeQuotedUserText } from '@shared/quote'
import { composeContextUserText } from '@shared/previewContext'
import { threadPath } from '@shared/thread'
import type { ChatMessage, MessageBlock, ToolCallBlock } from '@shared/types'

export function buildHistory(
  messages: ChatMessage[],
  leafId: string | null,
  model: Model<Api>
): Message[] {
  if (!leafId) return []
  const history: Message[] = []

  for (const message of threadPath(messages, leafId)) {
    if (message.role === 'system') continue
    if (message.role === 'user') {
      const quote =
        message.quoteMessageId && message.quoteSummary && message.quoteRole
          ? {
              messageId: message.quoteMessageId,
              summary: message.quoteSummary,
              role: message.quoteRole
            }
          : null
      // Stored content is the bubble body; quote marker, preview context and
      // attachments are reconstituted for the model only.
      const text = composeContextUserText(
        composeQuotedUserText(message.content, quote),
        message.contextBlocks,
        message.attachments
      )
      history.push({
        role: 'user',
        content: [{ type: 'text', text }],
        timestamp: message.createdAt
      })
      continue
    }
    history.push(...replayAssistant(message, model))
  }

  return history
}

/**
 * Splits one stored assistant turn back into the rounds it was streamed as.
 *
 * Every `toolCall` must be answered by a `toolResult` before the next
 * assistant message, so text arriving after a tool round closes the round.
 */
function replayAssistant(message: ChatMessage, model: Model<Api>): Message[] {
  const out: Message[] = []
  let content: AssistantMessage['content'] = []
  let results: Message[] = []

  const flush = (): void => {
    if (content.length) {
      out.push({
        role: 'assistant',
        content,
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: EMPTY_USAGE,
        stopReason: results.length ? 'toolUse' : 'stop',
        timestamp: message.createdAt
      })
    }
    out.push(...results)
    content = []
    results = []
  }

  for (const block of message.blocks) {
    if (block.kind === 'reasoning' || block.kind === 'plan') continue
    if (block.kind === 'text') {
      if (results.length) flush()
      if (block.text.trim()) content.push({ type: 'text', text: block.text })
      continue
    }
    content.push(toolCallOf(block))
    results.push({
      role: 'toolResult',
      toolCallId: block.id,
      toolName: block.tool,
      content: [{ type: 'text', text: block.output || '(no output)' }],
      isError: block.status === 'error',
      timestamp: message.createdAt
    })
  }
  flush()
  return out
}

function toolCallOf(block: ToolCallBlock): ToolCall {
  return {
    type: 'toolCall',
    id: block.id,
    name: block.tool,
    arguments: safeParseJson(block.input)
  }
}

/**
 * Projects pi's ordered assistant content into vav blocks.
 *
 * This is the fix for the ordering bug: pi addresses every partial event by
 * `contentIndex` into a single array, so text and tool calls come out in the
 * order the model produced them instead of all text first.
 */
export function blockFromContent(
  item: AssistantMessage['content'][number],
  toolStatus: (
    id: string
  ) =>
    | Pick<
        ToolCallBlock,
        'status' | 'output' | 'choices' | 'multiSelect' | 'questions' | 'askTitle'
      >
    | undefined,
  summarize: (name: string, args: Record<string, unknown>) => string
): MessageBlock | null {
  if (item.type === 'text') return { kind: 'text', text: item.text }
  if (item.type === 'thinking') return { kind: 'reasoning', text: item.thinking }
  if (item.type !== 'toolCall') return null

  const state = toolStatus(item.id)
  return {
    kind: 'toolCall',
    id: item.id,
    tool: item.name as ToolCallBlock['tool'],
    summary: summarize(item.name, item.arguments ?? {}),
    input: JSON.stringify(item.arguments ?? {}, null, 2),
    output: state?.output ?? '',
    status: state?.status ?? 'pending',
    ...(state?.choices ? { choices: state.choices } : {}),
    ...(state?.multiSelect != null ? { multiSelect: state.multiSelect } : {}),
    ...(state?.questions ? { questions: state.questions } : {}),
    ...(state?.askTitle ? { askTitle: state.askTitle } : {})
  }
}

export function safeParseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}
