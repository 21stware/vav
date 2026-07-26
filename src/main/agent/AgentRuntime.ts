import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentTool } from '@earendil-works/pi-agent-core'
import { runAgentLoopContinue } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
import {
  MAX_ITERATIONS,
  type ChatMessage,
  type Conversation,
  type MessageBlock,
  type ToolCallBlock,
  type ToolCallStatus,
  type ToolName,
  type TurnEvent,
  type TurnPhase,
  type TurnStatus
} from '@shared/types'
import { ROOT_LEAF } from '@shared/thread'
import { buildModel, describeError, streamWith } from './provider'
import { blockFromContent, buildHistory } from './history'
import {
  INTERACTIVE_TOOLS,
  READONLY_TOOLS,
  buildSystemPrompt,
  createTools,
  summarizeToolInput,
  type ToolDetails
} from './tools'
import type { ConversationStore } from '../store/ConversationStore'
import type { SettingsStore } from '../store/SettingsStore'
import type { SecretStore } from '../store/SecretStore'
import type { FileService } from '../fs/FileService'
import { StickyShell } from '../terminal/StickyShell'

/** Token deltas are batched this often before crossing the IPC boundary. */
const COALESCE_MS = 32

interface PendingUserTool {
  toolCallId: string
  resolve: (answer: { text: string; cancelled: boolean }) => void
}

interface ToolRuntimeState {
  status: ToolCallStatus
  output: string
  choices?: string[]
}

interface TurnState {
  abort: AbortController
  phase: TurnPhase
  toolCount: number
  messageId: string
  /** Where this reply hangs in the tree; siblings here are its other versions. */
  parentId: string | null
  /** The assistant message under construction, in emission order. */
  blocks: MessageBlock[]
  /**
   * `${llmTurn}:${contentIndex}` → index into {@link blocks}.
   *
   * pi restarts `contentIndex` at 0 for every LLM turn, but one vav turn can
   * span up to `MAX_ITERATIONS` of them, so the pair is what is actually unique.
   */
  slots: Map<string, number>
  llmTurn: number
  toolState: Map<string, ToolRuntimeState>
  /** Last card sent per tool id, so unchanged repeats stay off the wire. */
  sentCards: Map<string, string>
  /** Coalesced deltas, keyed by block index. */
  buffers: Map<number, string>
  flushTimer: NodeJS.Timeout | null
  pending: PendingUserTool | null
  error?: string
  cancelled?: boolean
}

export interface AgentRuntimeDeps {
  conversations: ConversationStore
  settings: SettingsStore
  secrets: SecretStore
  files: FileService
  emit: (event: TurnEvent) => void
}

/**
 * Runs agent turns, one per conversation, concurrently.
 *
 * The loop itself is pi's (`runAgentLoopContinue`): it owns the
 * completion → tools → completion cycle, argument validation, and the error
 * protocol. What stays here is everything product-shaped — vav's tools, the
 * message tree, the streaming projection the renderer subscribes to, and
 * cancellation that releases a turn parked on a user question.
 *
 * There is deliberately no process-wide "one agent at a time" lock: turns are
 * keyed by conversationId, switching conversations never cancels anything, and
 * `cancel` always targets a single id (README §8).
 */
export class AgentRuntime {
  private turns = new Map<string, TurnState>()
  private shells = new Map<string, StickyShell>()

  constructor(private deps: AgentRuntimeDeps) {}

  isRunning(conversationId: string): boolean {
    return this.turns.has(conversationId)
  }

  status(conversationId: string): TurnStatus {
    const turn = this.turns.get(conversationId)
    return {
      conversationId,
      isRunning: !!turn,
      phase: turn?.phase ?? 'idle',
      toolCount: turn?.toolCount ?? 0,
      awaitingToolCallId: turn?.pending?.toolCallId ?? null
    }
  }

  // -------------------------------------------------------------------------
  // Turn lifecycle
  // -------------------------------------------------------------------------

  async run(conversationId: string, userText: string, attachments: string[]): Promise<void> {
    if (this.turns.has(conversationId)) return
    const composed = attachments.length
      ? `${userText}\n\n附件路径：\n${attachments.map((p) => `- ${p}`).join('\n')}`
      : userText
    const leaf = this.deps.conversations.activeLeaf(conversationId)
    const parentId = leaf === ROOT_LEAF ? null : leaf
    await this.startTurn(conversationId, this.addUserMessage(conversationId, composed, parentId))
  }

  /**
   * Answers the same prompt again.
   *
   * Given a reply, the new message is its sibling; given a prompt, it is a new
   * child. Either way history stops before the reply being replaced, which is
   * what makes this a second version rather than a follow-up.
   */
  async regenerate(conversationId: string, messageId: string): Promise<void> {
    if (this.turns.has(conversationId)) return
    const conversation = this.deps.conversations.get(conversationId)
    const target = conversation?.messages.find((m) => m.id === messageId)
    if (!target) return
    const parentId = target.role === 'assistant' ? target.parentId : target.id

    this.deps.conversations.setActiveLeaf(conversationId, parentId)
    await this.startTurn(conversationId, parentId)
  }

  /**
   * Rewrites a prompt and answers the new wording.
   *
   * Same shape as regenerate, one level up: the edited prompt is a sibling of
   * the original, so the old prompt and everything under it stay reachable.
   */
  async editUserMessage(conversationId: string, messageId: string, text: string): Promise<void> {
    if (this.turns.has(conversationId)) return
    const conversation = this.deps.conversations.get(conversationId)
    const target = conversation?.messages.find((m) => m.id === messageId)
    if (!target || target.role !== 'user' || !text.trim()) return

    await this.startTurn(conversationId, this.addUserMessage(conversationId, text, target.parentId))
  }

  /**
   * Opens a branch at a message without saying anything in it yet.
   *
   * Nothing is stored — forking only moves the leaf, so the next prompt lands
   * as a sibling of whatever already follows. Forking a prompt branches from
   * the message above it, because two prompts in a row is not a conversation
   * any provider will accept.
   */
  fork(conversationId: string, messageId: string): string | null {
    if (this.turns.has(conversationId)) return null
    if (messageId === ROOT_LEAF) {
      this.deps.conversations.setActiveLeaf(conversationId, ROOT_LEAF)
      return ROOT_LEAF
    }
    const conversation = this.deps.conversations.get(conversationId)
    const target = conversation?.messages.find((m) => m.id === messageId)
    if (!target) return null

    const leaf = target.role === 'user' ? (target.parentId ?? ROOT_LEAF) : target.id
    this.deps.conversations.setActiveLeaf(conversationId, leaf)
    return leaf
  }

  private addUserMessage(conversationId: string, text: string, parentId: string | null): string {
    const message: ChatMessage = {
      id: randomUUID(),
      parentId,
      role: 'user',
      content: text,
      blocks: [{ kind: 'text', text }],
      createdAt: Date.now()
    }
    // Storing first is what lets auto-title fire before the turn starts.
    this.deps.conversations.appendMessage(conversationId, message)
    this.deps.emit({ type: 'user', conversationId, message })
    return message.id
  }

  private async startTurn(conversationId: string, parentId: string | null): Promise<void> {
    if (this.turns.has(conversationId)) return
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation) return

    const apiKey = this.deps.secrets.get()
    if (!apiKey) {
      this.emitFatal(conversationId, parentId, '尚未配置 API Key，请在 Settings 中配置后再发送。')
      return
    }

    const settings = this.deps.settings.get()
    const model = buildModel(
      settings,
      conversation.model || settings.defaultModel,
      conversation.tokenLimit
    )
    const history = buildHistory(conversation.messages, parentId, model)
    if (history.length === 0) {
      this.emitFatal(conversationId, parentId, '这条分支上没有可以重新回答的提问。')
      return
    }

    const turn: TurnState = {
      abort: new AbortController(),
      phase: 'thinking',
      toolCount: 0,
      messageId: randomUUID(),
      parentId,
      blocks: [],
      slots: new Map(),
      llmTurn: -1,
      toolState: new Map(),
      sentCards: new Map(),
      buffers: new Map(),
      flushTimer: null,
      pending: null
    }
    this.turns.set(conversationId, turn)
    this.deps.emit({ type: 'start', conversationId })
    this.setPhase(conversationId, turn, 'thinking')

    try {
      await runAgentLoopContinue(
        {
          systemPrompt: buildSystemPrompt(this.workdirOf(conversation), settings.shell),
          messages: history,
          tools: this.toolsFor(conversation, turn)
        },
        {
          model,
          apiKey,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          // The sticky shell is one serialized process and the interactive
          // cards are answered one at a time, so parallel execution would be a
          // lie in both cases.
          toolExecution: 'sequential',
          convertToLlm: (messages) => messages as Message[],
          beforeToolCall: async ({ toolCall }) => this.gateToolCall(conversationId, turn, toolCall),
          afterToolCall: async ({ result }) => ({
            isError: !!(result.details as ToolDetails | undefined)?.failed
          }),
          shouldStopAfterTurn: () => this.reachedIterationCap(conversationId, turn)
        },
        (event) => this.onAgentEvent(conversationId, turn, event),
        turn.abort.signal,
        (model_, context, options) => streamWith(model_, context, { ...options, apiKey })
      )
    } catch (err) {
      turn.error = describeError((err as Error).message)
    }

    this.finish(conversationId, turn)
  }

  cancel(conversationId: string): void {
    const turn = this.turns.get(conversationId)
    if (!turn) return
    turn.cancelled = true
    // An interactive tool waiting on the user must be released, or the loop
    // would stay parked on its promise forever.
    turn.pending?.resolve({ text: '', cancelled: true })
    turn.abort.abort()
  }

  cancelAll(): void {
    for (const id of [...this.turns.keys()]) this.cancel(id)
  }

  /** Routes a card answer back into the paused turn. */
  answer(conversationId: string, toolCallId: string, text: string): void {
    const turn = this.turns.get(conversationId)
    if (!turn?.pending || turn.pending.toolCallId !== toolCallId) return
    turn.pending.resolve({ text, cancelled: false })
  }

  disposeConversation(conversationId: string): void {
    this.cancel(conversationId)
    this.shells.get(conversationId)?.dispose()
    this.shells.delete(conversationId)
  }

  disposeAll(): void {
    this.cancelAll()
    for (const shell of this.shells.values()) shell.dispose()
    this.shells.clear()
  }

  setWorkingDirectory(conversationId: string, cwd: string): void {
    this.shells.get(conversationId)?.setWorkingDirectory(cwd)
  }

  applyShellSetting(): void {
    const shell = this.deps.settings.get().shell
    for (const sticky of this.shells.values()) sticky.setShell(shell)
  }

  // -------------------------------------------------------------------------
  // Agent events → transcript blocks
  // -------------------------------------------------------------------------

  private onAgentEvent(conversationId: string, turn: TurnState, event: AgentEvent): void {
    switch (event.type) {
      case 'turn_start':
        turn.llmTurn += 1
        this.setPhase(conversationId, turn, 'thinking')
        break

      case 'message_update':
        this.onStreamEvent(conversationId, turn, event.assistantMessageEvent)
        break

      case 'message_end':
        this.flushBuffers(conversationId, turn)
        // pi does not forward the stream's `error` event; a failed request
        // arrives as a final assistant message carrying the stop reason.
        if (isAssistant(event.message)) {
          if (event.message.stopReason === 'aborted') turn.cancelled = true
          else if (event.message.stopReason === 'error') {
            turn.error = describeError(event.message.errorMessage ?? '模型返回错误')
          }
        }
        break

      case 'tool_execution_start': {
        const interactive = INTERACTIVE_TOOLS.has(event.toolName as ToolName)
        this.patchTool(conversationId, turn, event.toolCallId, {
          status: interactive ? 'pending' : 'executing'
        })
        if (!interactive) this.setPhase(conversationId, turn, 'working')
        break
      }

      case 'tool_execution_end': {
        const details = event.result?.details as ToolDetails | undefined
        this.patchTool(conversationId, turn, event.toolCallId, {
          status: event.isError ? 'error' : 'completed',
          output: details?.display ?? textOf(event.result?.content) ?? ''
        })
        turn.toolCount += 1
        // Tool boundary: one of the two allowed persistence points.
        this.persistPartial(conversationId, turn)
        break
      }

      case 'turn_end':
        if (isAssistant(event.message)) {
          const used = event.message.usage.input + event.message.usage.output
          if (used > 0) this.deps.conversations.addTokens(conversationId, used)
        }
        break
    }
  }

  /** The ordering fix: every partial is placed by its `contentIndex`. */
  private onStreamEvent(conversationId: string, turn: TurnState, event: StreamEvent): void {
    switch (event.type) {
      case 'text_start':
        this.slotFor(turn, event.contentIndex, { kind: 'text', text: '' })
        break

      case 'text_delta': {
        this.setPhase(conversationId, turn, 'outputting')
        const slot = this.slotFor(turn, event.contentIndex, { kind: 'text', text: '' })
        this.appendDelta(conversationId, turn, slot, event.delta)
        break
      }

      case 'thinking_start':
        this.slotFor(turn, event.contentIndex, { kind: 'reasoning', text: '' })
        break

      case 'thinking_delta': {
        this.setPhase(conversationId, turn, 'thinking')
        const slot = this.slotFor(turn, event.contentIndex, { kind: 'reasoning', text: '' })
        this.appendDelta(conversationId, turn, slot, event.delta)
        break
      }

      case 'toolcall_start':
      case 'toolcall_end': {
        // Reserve the card's position as soon as the call opens, so a reply
        // that resumes talking afterwards lands below it rather than above.
        const call = event.partial.content[event.contentIndex]
        if (!call || call.type !== 'toolCall') break
        const block = blockFromContent(
          call,
          (id) => turn.toolState.get(id),
          (name, args) => summarizeToolInput(name as ToolName, args)
        )
        if (!block) break
        const slot = this.slotFor(turn, event.contentIndex, block)
        // Flush first: the card must not jump ahead of text already buffered.
        this.flushBuffers(conversationId, turn)
        turn.blocks[slot] = block
        this.sendCard(conversationId, turn, slot, block as ToolCallBlock)
        break
      }
    }
  }

  /** Stable position for one `(llm turn, contentIndex)` pair. */
  private slotFor(turn: TurnState, contentIndex: number, seed: MessageBlock): number {
    const key = `${turn.llmTurn}:${contentIndex}`
    const existing = turn.slots.get(key)
    if (existing !== undefined) return existing
    const slot = turn.blocks.length
    turn.blocks.push(seed)
    turn.slots.set(key, slot)
    return slot
  }

  private appendDelta(
    conversationId: string,
    turn: TurnState,
    slot: number,
    text: string
  ): void {
    if (!text) return
    const block = turn.blocks[slot]
    if (block?.kind === 'text' || block?.kind === 'reasoning') block.text += text
    turn.buffers.set(slot, (turn.buffers.get(slot) ?? '') + text)
    if (turn.flushTimer) return
    turn.flushTimer = setTimeout(() => {
      turn.flushTimer = null
      this.flushBuffers(conversationId, turn)
    }, COALESCE_MS)
  }

  private flushBuffers(conversationId: string, turn: TurnState): void {
    if (turn.flushTimer) {
      clearTimeout(turn.flushTimer)
      turn.flushTimer = null
    }
    if (turn.buffers.size === 0) return
    // Ascending slot order keeps the renderer's projection in emission order.
    for (const slot of [...turn.buffers.keys()].sort((a, b) => a - b)) {
      const text = turn.buffers.get(slot)!
      const block = turn.blocks[slot]
      if (!text || (block?.kind !== 'text' && block?.kind !== 'reasoning')) continue
      this.deps.emit({
        type: 'delta',
        conversationId,
        index: slot,
        kind: block.kind === 'reasoning' ? 'reasoning' : 'text',
        text
      })
    }
    turn.buffers.clear()
  }

  private patchTool(
    conversationId: string,
    turn: TurnState,
    toolCallId: string,
    patch: Partial<ToolRuntimeState>
  ): void {
    const state = turn.toolState.get(toolCallId) ?? { status: 'pending' as ToolCallStatus, output: '' }
    Object.assign(state, patch)
    turn.toolState.set(toolCallId, state)

    const slot = turn.blocks.findIndex((b) => b.kind === 'toolCall' && b.id === toolCallId)
    if (slot < 0) return
    const block = { ...(turn.blocks[slot] as ToolCallBlock), ...state }
    turn.blocks[slot] = block
    this.sendCard(conversationId, turn, slot, block)
  }

  /**
   * A card is touched from several directions — the stream opening the call,
   * the loop starting it, the tool finishing — and most of those touches change
   * nothing. Only send the ones that do.
   */
  private sendCard(
    conversationId: string,
    turn: TurnState,
    index: number,
    block: ToolCallBlock
  ): void {
    const encoded = JSON.stringify(block)
    if (turn.sentCards.get(block.id) === encoded) return
    turn.sentCards.set(block.id, encoded)
    this.deps.emit({ type: 'tool', conversationId, index, block })
  }

  // -------------------------------------------------------------------------
  // Tools
  // -------------------------------------------------------------------------

  private toolsFor(conversation: Conversation, turn: TurnState): AgentTool[] {
    const conversationId = conversation.id
    return createTools({
      workdir: this.workdirOf(conversation),
      settings: () => this.deps.settings.get(),
      files: this.deps.files,
      shell: () => this.shellFor(conversation),
      mirror: (text) => this.deps.emit({ type: 'mirror', conversationId, text }),
      fsChanged: (parentPath, filePath) =>
        this.deps.emit({ type: 'fs-changed', conversationId, parentPath, filePath }),
      ask: (toolCallId, summary, choices) =>
        this.askUser(conversationId, turn, toolCallId, summary, choices)
    })
  }

  /** Read-only tools are gated by the autoApproveReadonly capability switch. */
  private async gateToolCall(
    conversationId: string,
    turn: TurnState,
    toolCall: { id: string; name: string }
  ): Promise<{ block: boolean; reason?: string } | undefined> {
    const name = toolCall.name as ToolName
    if (!READONLY_TOOLS.has(name) || this.deps.settings.get().autoApproveReadonly) return undefined

    const block = turn.blocks.find(
      (b): b is ToolCallBlock => b.kind === 'toolCall' && b.id === toolCall.id
    )
    const approval = await this.askUser(
      conversationId,
      turn,
      toolCall.id,
      `允许执行 ${name}？${block?.summary ?? ''}`,
      ['允许', '拒绝']
    )
    if (approval.cancelled) return { block: true, reason: '用户取消了本轮' }
    if (approval.text === '拒绝') return { block: true, reason: '用户拒绝了该操作' }
    return undefined
  }

  /** Parks the turn until the renderer routes an answer back for this card. */
  private askUser(
    conversationId: string,
    turn: TurnState,
    toolCallId: string,
    summary: string,
    choices?: string[]
  ): Promise<{ text: string; cancelled: boolean }> {
    if (turn.abort.signal.aborted) return Promise.resolve({ text: '', cancelled: true })

    this.patchTool(conversationId, turn, toolCallId, { status: 'pending', choices })
    const slot = turn.blocks.findIndex((b) => b.kind === 'toolCall' && b.id === toolCallId)
    this.setPhase(conversationId, turn, 'awaiting-user')
    if (slot >= 0) {
      const block = turn.blocks[slot] as ToolCallBlock
      this.deps.emit({
        type: 'awaiting',
        conversationId,
        toolCallId,
        index: slot,
        block: { ...block, summary: summary || block.summary, choices }
      })
    }

    return new Promise((resolve) => {
      turn.pending = {
        toolCallId,
        resolve: (answer) => {
          turn.pending = null
          this.setPhase(conversationId, turn, 'working')
          resolve(answer)
        }
      }
    })
  }

  private reachedIterationCap(conversationId: string, turn: TurnState): boolean {
    if (turn.llmTurn < MAX_ITERATIONS - 1) return false
    const slot = turn.blocks.length
    turn.blocks.push({
      kind: 'text',
      text: '\n\n> 本轮工具迭代已达上限（12 次）。请发送新消息继续。'
    })
    this.deps.emit({
      type: 'delta',
      conversationId,
      index: slot,
      kind: 'text',
      text: '\n\n> 本轮工具迭代已达上限（12 次）。请发送新消息继续。'
    })
    return true
  }

  private setPhase(conversationId: string, turn: TurnState, phase: TurnPhase): void {
    if (turn.phase === phase) return
    turn.phase = phase
    this.deps.emit({ type: 'phase', conversationId, phase })
  }

  // -------------------------------------------------------------------------
  // Completion
  // -------------------------------------------------------------------------

  private persistPartial(conversationId: string, turn: TurnState): void {
    this.deps.conversations.replaceMessage(conversationId, this.snapshot(turn))
  }

  private snapshot(turn: TurnState, extra: Partial<ChatMessage> = {}): ChatMessage {
    // A slot is claimed when its content block opens, which can be a moment
    // before any token lands in it; those empties are not worth persisting.
    const blocks = turn.blocks.filter(
      (b) => b.kind === 'toolCall' || b.text.length > 0
    )
    return {
      id: turn.messageId,
      parentId: turn.parentId,
      role: 'assistant',
      content: blocks
        .filter((b): b is Extract<MessageBlock, { kind: 'text' }> => b.kind === 'text')
        .map((b) => b.text)
        .join('\n'),
      blocks: blocks.map((b) => ({ ...b })),
      createdAt: Date.now(),
      ...extra
    }
  }

  private finish(conversationId: string, turn: TurnState): void {
    this.flushBuffers(conversationId, turn)
    if (turn.flushTimer) clearTimeout(turn.flushTimer)

    if (turn.cancelled) {
      // Seal whatever arrived rather than discarding it.
      for (const block of turn.blocks) {
        if (block.kind === 'toolCall' && (block.status === 'pending' || block.status === 'executing')) {
          block.status = 'expired'
        }
      }
    }
    if (turn.error) {
      turn.blocks.push({
        kind: 'text',
        text: turn.blocks.length ? `\n\n> ${turn.error}` : `> ${turn.error}`
      })
    }

    const message = this.snapshot(turn, {
      cancelled: turn.cancelled,
      errorText: turn.error
    })
    this.turns.delete(conversationId)

    if (message.blocks.length > 0) {
      this.deps.conversations.replaceMessage(conversationId, message)
    }
    this.deps.conversations.flush()

    const conversation = this.deps.conversations.get(conversationId)
    this.deps.emit({
      type: 'end',
      conversationId,
      message,
      tokensUsed: conversation?.tokensUsed ?? 0,
      error: turn.error,
      cancelled: turn.cancelled
    })
  }

  /** Emits a terminal failure for a turn that never started (e.g. missing key). */
  private emitFatal(conversationId: string, parentId: string | null, error: string): void {
    const message: ChatMessage = {
      id: randomUUID(),
      parentId,
      role: 'assistant',
      content: error,
      blocks: [{ kind: 'text', text: `> ${error}` }],
      createdAt: Date.now(),
      errorText: error
    }
    this.deps.conversations.appendMessage(conversationId, message)
    this.deps.conversations.flush()
    this.deps.emit({
      type: 'end',
      conversationId,
      message,
      tokensUsed: this.deps.conversations.get(conversationId)?.tokensUsed ?? 0,
      error
    })
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private workdirOf(conversation: Conversation): string {
    return conversation.workingDirectory ?? process.env.HOME ?? '/'
  }

  private shellFor(conversation: Conversation): StickyShell {
    let shell = this.shells.get(conversation.id)
    if (!shell) {
      shell = new StickyShell(this.deps.settings.get().shell, this.workdirOf(conversation))
      this.shells.set(conversation.id, shell)
    }
    return shell
  }
}

type StreamEvent = Extract<AgentEvent, { type: 'message_update' }>['assistantMessageEvent']

function isAssistant(message: unknown): message is AssistantMessage {
  return (message as AssistantMessage)?.role === 'assistant'
}

/** Fallback card text for results pi synthesised itself (blocked, not found). */
function textOf(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  return content
    .filter((part): part is { type: 'text'; text: string } => part?.type === 'text')
    .map((part) => part.text)
    .join('\n')
}
