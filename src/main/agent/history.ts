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
 *
 * Manual compaction: when a {@link LeafCompaction} applies, earlier path
 * messages are replaced by a short summary pair; originals stay on disk for UI.
 */
import type { Api, AssistantMessage, Message, Model, ToolCall } from '@earendil-works/pi-ai'
import { composeQuotedUserText } from '@shared/quote'
import { composeContextUserText } from '@shared/previewContext'
import {
  compactionBoundaryIndex,
  compactionForLeaf,
  estimateTextTokens
} from '@shared/compaction'
import { threadPath } from '@shared/thread'
import type { ChatMessage, LeafCompaction, MessageBlock, ToolCallBlock } from '@shared/types'

const SUMMARY_USER_PREFIX =
  '[Conversation summary — earlier turns compacted; full transcript remains in the app]\n\n'
const SUMMARY_ASSISTANT_ACK =
  'Understood. I will continue from this summary and the messages that follow.'

/**
 * Cap tool-result bodies sent to the live model. Full output stays on disk for
 * the UI; unbounded tool dumps were the dominant history payload cost.
 */
const LIVE_TOOL_OUTPUT_MAX = 24_000

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

export function buildHistory(
  messages: ChatMessage[],
  leafId: string | null,
  model: Model<Api>,
  compactions?: LeafCompaction[] | null
): Message[] {
  if (!leafId) return []
  const path = threadPath(messages, leafId)
  const compaction = compactionForLeaf(compactions, messages, leafId)
  const boundary = compactionBoundaryIndex(path, compaction)

  const history: Message[] = []
  let start = 0

  if (compaction && boundary > 0) {
    history.push({
      role: 'user',
      content: [{ type: 'text', text: SUMMARY_USER_PREFIX + compaction.summary.trim() }],
      timestamp: compaction.createdAt
    })
    history.push({
      role: 'assistant',
      content: [{ type: 'text', text: SUMMARY_ASSISTANT_ACK }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: EMPTY_USAGE,
      stopReason: 'stop',
      timestamp: compaction.createdAt
    })
    start = boundary
  }

  for (let i = start; i < path.length; i++) {
    const message = path[i]!
    if (message.role === 'system') {
      // Workspace notices (Discard, etc.) — model-visible as a tagged user turn
      // so providers that reject mid-thread system roles still see them.
      const notice = message.content.trim()
      if (notice) {
        history.push({
          role: 'user',
          content: [{ type: 'text', text: `[Workspace notice]\n${notice}` }],
          timestamp: message.createdAt
        })
      }
      continue
    }
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
 * Flatten a path segment into plain text for the summarizer (not the live model
 * history). Tool bodies are truncated so compact stays cheap.
 */
export function pathToSummarySource(messages: ChatMessage[], maxChars = 48_000): string {
  const parts: string[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      const body = message.content.trim()
      if (body) parts.push(`Notice:\n${truncate(body, 1_500)}`)
      continue
    }
    if (message.role === 'user') {
      const body = message.content.trim() || '(empty)'
      parts.push(`User:\n${truncate(body, 4_000)}`)
      continue
    }
    const chunks: string[] = []
    for (const block of message.blocks) {
      if (block.kind === 'text' && block.text.trim()) {
        chunks.push(truncate(block.text.trim(), 3_000))
      } else if (block.kind === 'toolCall') {
        const out = truncate((block.output || '').trim() || '(no output)', 800)
        chunks.push(`[tool ${block.tool}] ${block.summary}\n${out}`)
      }
    }
    parts.push(`Assistant:\n${chunks.join('\n') || '(no content)'}`)
  }
  const joined = parts.join('\n\n')
  return truncate(joined, maxChars)
}

/**
 * Estimate next-request input tokens after a compact: summary pair + kept tail.
 * Does not include the live system prompt (same for pre/post — relative shrink is what matters).
 */
export function estimateCompactedContextTokens(
  summary: string,
  keptMessages: ChatMessage[]
): number {
  const summaryPart =
    estimateTextTokens(SUMMARY_USER_PREFIX) +
    estimateTextTokens(summary) +
    estimateTextTokens(SUMMARY_ASSISTANT_ACK)
  const tail = pathToSummarySource(keptMessages, 200_000)
  // Small overhead for role framing / tool envelopes in the real request.
  return summaryPart + estimateTextTokens(tail) + 64
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
    if (block.kind === 'plan') continue
    // DeepSeek (and other thinking models) require reasoning_content back on
    // any turn that used tools. Dropping it disables thinking on the next
    // LLM call or 400s the request.
    if (block.kind === 'reasoning') {
      if (results.length) flush()
      if (block.text.trim()) {
        content.push({
          type: 'thinking',
          thinking: block.text,
          thinkingSignature: 'reasoning_content'
        })
      }
      continue
    }
    if (block.kind === 'text') {
      if (results.length) flush()
      if (block.text.trim()) content.push({ type: 'text', text: block.text })
      continue
    }
    content.push(toolCallOf(block))
    const raw = block.output || '(no output)'
    results.push({
      role: 'toolResult',
      toolCallId: block.id,
      toolName: block.tool,
      content: [{ type: 'text', text: truncate(raw, LIVE_TOOL_OUTPUT_MAX) }],
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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
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
