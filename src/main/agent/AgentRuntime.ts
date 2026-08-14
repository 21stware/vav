import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import type { AgentEvent, AgentTool } from '@earendil-works/pi-agent-core'
import { runAgentLoopContinue } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
import {
  type ChatMessage,
  type Conversation,
  type MessageBlock,
  type PreviewRef,
  type QuoteDraft,
  type ToolCallBlock,
  type ToolCallStatus,
  type ToolName,
  type TurnEvent,
  type TurnPhase,
  type TurnStatus
} from '@shared/types'
import { ROOT_LEAF } from '@shared/thread'
import { buildSnapshot } from '@shared/tokenUsage'
import { buildModel, describeError, streamWith } from './provider'
import { parseThinkingLevel, toPiReasoning } from '@shared/thinkingLevel'
import { normalizePlanSteps } from '@shared/askPlan'
import {
  COMPACT_MIN_FOLDED,
  defaultKeepAfterIndex
} from '@shared/compaction'
import { threadPath } from '@shared/thread'
import type { LeafCompaction } from '@shared/types'
import {
  blockFromContent,
  buildHistory,
  estimateCompactedContextTokens,
  pathToSummarySource,
  safeParseJson
} from './history'
import {
  HIGH_RISK_TOOLS,
  INTERACTIVE_TOOLS,
  READONLY_TOOLS,
  buildSystemPrompt,
  createTools,
  FILE_READONLY_BLOCKED_TOOLS,
  isFileEditLockedPath,
  isReadonlyTerminalCommand,
  summarizeToolInput,
  type ToolDetails
} from './tools'
import { FileDraftCoalescer, writeToolDraft } from '@shared/writeToolDraft'
import type { ConversationStore } from '../store/ConversationStore'
import { kindFromFilePath } from '../store/FileSessionStore'
import type { SettingsStore } from '../store/SettingsStore'
import type { SecretStore } from '../store/SecretStore'
import type { FileService } from '../fs/FileService'
import type { DocumentRetrievalService } from '../retrieval/DocumentRetrievalService'
import type { DuckDbService } from '../fs/DuckDbService'
import type { WebSearchService } from '../web/WebSearchService'
import type { WebFetchService } from '../web/WebFetchService'
import type { FileSessionStore } from '../store/FileSessionStore'
import type { SkillService } from './SkillService'
import { StickyShell } from '../terminal/StickyShell'
import { isApprovalApproveText, isApprovalDenyText } from '@shared/i18n'
import { t } from '../i18n'

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
  multiSelect?: boolean
  questions?: import('@shared/types').AskQuestion[]
  askTitle?: string
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
   * span many of them, so the pair is what is actually unique.
   */
  slots: Map<string, number>
  llmTurn: number
  toolState: Map<string, ToolRuntimeState>
  /** Last card sent per tool id, so unchanged repeats stay off the wire. */
  sentCards: Map<string, string>
  /** Coalesced deltas, keyed by block index. */
  buffers: Map<number, string>
  flushTimer: NodeJS.Timeout | null
  /**
   * Parked interactive/approval waiters, keyed by toolCallId.
   * A single slot used to drop the second gate when two cards overlapped
   * (or when answer arrived with a desynced id); the map keeps every
   * sequential Approve/Deny resolvable.
   */
  pending: Map<string, PendingUserTool>
  /** Edit-mode approvals may rewrite tool args before execute. */
  argOverrides: Map<string, Record<string, unknown>>
  /** User selection for this turn (doc_search related_to_selection). */
  selectionRefs: PreviewRef[]
  /** First-token wall time per reasoning slot, used to stamp `durationMs`. */
  reasoningStartedAt: Map<number, number>
  error?: string
  cancelled?: boolean
}

export interface AgentRuntimeDeps {
  conversations: ConversationStore
  settings: SettingsStore
  secrets: SecretStore
  files: FileService
  emit: (event: TurnEvent) => void
  changeSets?: import('./ChangeSetStore').ChangeSetStore
  retrieval?: DocumentRetrievalService
  duckdb?: DuckDbService
  webSearch?: WebSearchService
  webFetch?: WebFetchService
  skills?: SkillService
  fileSessions?: FileSessionStore
  /** Sync preview chrome when the agent flips Read/Edit via switch_mode. */
  onFileReadOnlyChange?: (conversationId: string, readOnly: boolean) => void
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
  /** Notices deferred while a turn is streaming (must land after the assistant leaf). */
  private pendingNotices = new Map<string, string[]>()

  private turns = new Map<string, TurnState>()
  private shells = new Map<string, StickyShell>()
  private fileDrafts = new FileDraftCoalescer()

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
      awaitingToolCallId: turn ? (turn.pending.keys().next().value ?? null) : null,
      messageId: turn?.messageId ?? null,
      // Preserve slot indices — StreamProjection is sparse on contentIndex, and
      // filtering empties here would mis-align later delta/tool patches.
      blocks: turn ? turn.blocks.map((block) => ({ ...block })) : []
    }
  }

  // -------------------------------------------------------------------------
  // Turn lifecycle
  // -------------------------------------------------------------------------

  async run(
    conversationId: string,
    userText: string,
    attachments: string[],
    quote?: QuoteDraft | null,
    contextBlocks?: PreviewRef[] | null,
    contextFile?: string | null
  ): Promise<void> {
    if (this.turns.has(conversationId)) return
    // Bubble body stays user-typed only. Quote, preview context, attachments and
    // the file chip are stored as fields and reconstituted in buildHistory /
    // rendered as chips in the transcript (same shapes as the composer).
    const leaf = this.deps.conversations.activeLeaf(conversationId)
    const parentId = leaf === ROOT_LEAF ? null : leaf
    await this.startTurn(
      conversationId,
      this.addUserMessage(
        conversationId,
        userText,
        parentId,
        quote,
        contextBlocks,
        attachments,
        contextFile
      )
    )
  }

  /**
   * Append a system notice without starting a turn. Used for UI actions the
   * model should see on the next send (Discard Changes, etc.).
   * While a turn is running, notices are queued and flushed after the assistant
   * leaf so they stay on the active transcript path.
   */
  appendNotice(conversationId: string, text: string): void {
    const body = text.trim()
    if (!body) return
    if (!this.deps.conversations.get(conversationId)) return
    if (this.turns.has(conversationId)) {
      const queue = this.pendingNotices.get(conversationId) ?? []
      queue.push(body)
      this.pendingNotices.set(conversationId, queue)
      return
    }
    this.writeNotice(conversationId, body)
  }

  private writeNotice(conversationId: string, body: string): void {
    const leaf = this.deps.conversations.activeLeaf(conversationId)
    const parentId = leaf === ROOT_LEAF ? null : leaf
    const message: ChatMessage = {
      id: randomUUID(),
      parentId,
      role: 'system',
      content: body,
      blocks: [{ kind: 'text', text: body }],
      createdAt: Date.now()
    }
    this.deps.conversations.appendMessage(conversationId, message)
    this.deps.conversations.flush()
    this.deps.emit({ type: 'notice', conversationId, message })
  }

  private flushPendingNotices(conversationId: string): void {
    const queue = this.pendingNotices.get(conversationId)
    if (!queue?.length) return
    this.pendingNotices.delete(conversationId)
    for (const body of queue) this.writeNotice(conversationId, body)
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

  /**
   * Manual context compact for the active leaf path.
   *
   * Originals stay in the message tree; {@link buildHistory} injects a summary
   * for everything before `keepAfterMessageId`. Omit keepAfter to fold all but
   * the last few turns.
   */
  async compact(
    conversationId: string,
    options?: { keepAfterMessageId?: string | null }
  ): Promise<
    | { ok: true; compaction: LeafCompaction }
    | { ok: false; error: string }
  > {
    if (this.turns.has(conversationId)) {
      return { ok: false, error: t('compact.error.busy') }
    }
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation) return { ok: false, error: t('compact.error.missing') }
    if (conversation.cliHost) {
      return { ok: false, error: t('compact.error.cliHost') }
    }

    const leafId = conversation.activeLeafId ?? threadPath(conversation.messages, null).at(-1)?.id
    if (!leafId) return { ok: false, error: t('compact.error.empty') }

    const path = threadPath(conversation.messages, leafId)
    let keepIdx: number | null = null
    if (options?.keepAfterMessageId) {
      keepIdx = path.findIndex((m) => m.id === options.keepAfterMessageId)
      if (keepIdx < COMPACT_MIN_FOLDED) {
        return { ok: false, error: t('compact.error.notEnough') }
      }
    } else {
      keepIdx = defaultKeepAfterIndex(path.length)
      if (keepIdx == null) return { ok: false, error: t('compact.error.notEnough') }
    }

    const keepAfterMessageId = path[keepIdx]!.id
    const toFold = path.slice(0, keepIdx)
    if (toFold.length < COMPACT_MIN_FOLDED) {
      return { ok: false, error: t('compact.error.notEnough') }
    }

    const apiKey = this.deps.secrets.get()
    if (!apiKey) return { ok: false, error: t('error.noApiKey') }

    const settings = this.deps.settings.get()
    const model = buildModel(
      settings,
      conversation.model || settings.defaultModel,
      conversation.tokenLimit
    )

    let summary: string
    try {
      summary = await this.summarizeForCompact(toFold, model, apiKey, settings.maxTokens)
    } catch (err) {
      return { ok: false, error: describeError((err as Error).message) }
    }
    if (!summary.trim()) return { ok: false, error: t('compact.error.failed') }

    const summaryText = summary.trim()
    const kept = path.slice(keepIdx)
    const estimatedContextTokens = estimateCompactedContextTokens(summaryText, kept)
    const compaction: LeafCompaction = {
      leafId,
      keepAfterMessageId,
      summary: summaryText,
      createdAt: Date.now(),
      compactedCount: toFold.length,
      estimatedContextTokens
    }
    this.deps.conversations.setCompaction(conversationId, compaction)
    // Context ring / popup read tokensUsed as "fill" — shrink immediately so
    // compact is visible without waiting for the next model turn.
    this.deps.conversations.setContextFill(conversationId, estimatedContextTokens)
    return { ok: true, compaction }
  }

  clearCompaction(
    conversationId: string,
    leafId: string
  ): { ok: true } | { ok: false; error: string } {
    if (this.turns.has(conversationId)) {
      return { ok: false, error: t('compact.error.busy') }
    }
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation) {
      return { ok: false, error: t('compact.error.missing') }
    }
    if (conversation.cliHost) {
      return { ok: false, error: t('compact.error.cliHost') }
    }
    this.deps.conversations.clearCompaction(conversationId, leafId)
    return { ok: true }
  }

  private async summarizeForCompact(
    messages: ChatMessage[],
    model: import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>,
    apiKey: string,
    maxTokens: number
  ): Promise<string> {
    const source = pathToSummarySource(messages)
    const prompt =
      'Summarize the following conversation for continuity. Use this structure:\n' +
      '## Goal\n## Decisions\n## Files / tools touched\n## Open todos / constraints\n## Do not redo\n\n' +
      'Be concrete (paths, names, outcomes). Max ~400 words. No preamble.\n\n---\n\n' +
      source

    const result = await streamWith(
      model,
      {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
            timestamp: Date.now()
          }
        ]
      },
      {
        apiKey,
        maxTokens: Math.min(1200, Math.max(256, maxTokens)),
        temperature: 0.2,
        signal: AbortSignal.timeout(90_000)
      }
    ).result()

    if (result.stopReason === 'error' || result.stopReason === 'aborted') {
      throw new Error(result.errorMessage ?? 'summarize failed')
    }
    const text = result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('')
      .trim()
    return text
  }

  private addUserMessage(
    conversationId: string,
    text: string,
    parentId: string | null,
    quote?: QuoteDraft | null,
    contextBlocks?: PreviewRef[] | null,
    attachments?: string[] | null,
    contextFile?: string | null
  ): string {
    const message: ChatMessage = {
      id: randomUUID(),
      parentId,
      role: 'user',
      content: text,
      blocks: [{ kind: 'text', text }],
      createdAt: Date.now(),
      ...(quote
        ? {
            quoteMessageId: quote.messageId,
            quoteSummary: quote.summary,
            quoteRole: quote.role
          }
        : {}),
      ...(contextBlocks && contextBlocks.length ? { contextBlocks } : {}),
      ...(attachments && attachments.length ? { attachments: [...attachments] } : {}),
      ...(contextFile ? { contextFile } : {})
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
      this.emitFatal(conversationId, parentId, t('error.noApiKey'))
      return
    }

    const settings = this.deps.settings.get()
    const model = buildModel(
      settings,
      conversation.model || settings.defaultModel,
      conversation.tokenLimit
    )
    const history = buildHistory(
      conversation.messages,
      parentId,
      model,
      conversation.compactions
    )
    if (history.length === 0) {
      this.emitFatal(conversationId, parentId, t('error.noRetryParent'))
      return
    }

    const parentMessage = conversation.messages.find((m) => m.id === parentId)
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
      pending: new Map(),
      argOverrides: new Map(),
      selectionRefs: parentMessage?.contextBlocks ?? [],
      reasoningStartedAt: new Map()
    }
    this.turns.set(conversationId, turn)
    this.deps.changeSets?.beginTurn(conversationId, this.workdirOf(conversation))
    // Document sandbox: ensure a working copy for the focused / file-session path
    // so agent tools and officecli mutate the copy, not the user's original.
    const logicalOpenPath =
      conversation.focusedFilePath ||
      (conversation.fileId && this.deps.fileSessions
        ? this.deps.fileSessions.pathForFileId(conversation.fileId)
        : null)
    let openFilePathForPrompt: string | null = conversation.focusedFilePath || null
    if (logicalOpenPath && this.deps.files.workingCopies) {
      try {
        const wc = await this.deps.files.workingCopies.ensure(logicalOpenPath, {
          fileId: conversation.fileId
        })
        // Point the model at the sandbox path so officecli/shell write the copy.
        if (conversation.focusedFilePath) openFilePathForPrompt = wc.copyPath
      } catch (err) {
        console.warn('[agent] working-copy ensure failed', logicalOpenPath, err)
      }
    }
    // Strip prior turn changeSetId from stored messages so reloads don't show
    // dead "Could not load changes" cards under Done.
    this.stripPriorChangeSetIds(conversationId)
    this.deps.emit({ type: 'start', conversationId })
    this.setPhase(conversationId, turn, 'thinking')

    const reasoning = model.reasoning
      ? toPiReasoning(parseThinkingLevel(conversation.thinkingLevel))
      : undefined

    try {
      await runAgentLoopContinue(
        {
          systemPrompt: buildSystemPrompt(this.workdirOf(conversation), settings.shell, {
            fileReadOnly: !!conversation.fileReadOnly,
            // Only when the File Attachment Chip is attached (focusedFilePath).
            // When sandboxed, this is the working-copy path (agent must edit that).
            openFilePath: openFilePathForPrompt,
            // Prefer the focused path (chip may differ from session fileId).
            openFileKind: conversation.focusedFilePath
              ? kindFromFilePath(conversation.focusedFilePath) ??
                (conversation.fileId && this.deps.fileSessions
                  ? this.deps.fileSessions.kindForFileId(conversation.fileId)
                  : null)
              : null,
            skillCatalog: this.deps.skills?.catalogForPrompt() ?? null
          }),
          messages: history,
          tools: this.toolsFor(conversation, turn)
        },
        {
          model,
          apiKey,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          ...(reasoning ? { reasoning } : {}),
          // The sticky shell is one serialized process and the interactive
          // cards are answered one at a time, so parallel execution would be a
          // lie in both cases.
          toolExecution: 'sequential',
          convertToLlm: (messages) => messages as Message[],
          beforeToolCall: async ({ toolCall, args }) =>
            this.gateToolCall(conversationId, turn, toolCall, args),
          afterToolCall: async ({ result }) => ({
            isError: !!(result.details as ToolDetails | undefined)?.failed
          }),
          shouldStopAfterTurn: () => false
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
    const stopTurn = (id: string, turn: TurnState): void => {
      turn.cancelled = true
      // An interactive tool waiting on the user must be released, or the loop
      // would stay parked on its promise forever.
      this.releaseAllPending(turn, { text: '', cancelled: true })
      // Kill the in-flight terminal command first — aborting the loop alone
      // leaves `shell.run` blocked until exit/timeout, so Stop looked dead.
      this.shells.get(id)?.interrupt()
      turn.abort.abort()
    }
    const turn = this.turns.get(conversationId)
    if (turn) {
      stopTurn(conversationId, turn)
      return
    }
    // Focus desync (file-preview agent session ≠ sidebar activeId): stop every
    // parked/awaiting turn so Stop still works.
    for (const [id, t] of this.turns) {
      if (t.pending.size === 0 && t.phase !== 'awaiting-user' && t.phase !== 'working') continue
      stopTurn(id, t)
    }
  }

  cancelAll(): void {
    for (const id of [...this.turns.keys()]) this.cancel(id)
  }

  /** Routes a card answer back into the paused turn. */
  answer(conversationId: string, toolCallId: string, text: string): boolean {
    const payload = { text, cancelled: false as const }
    const preferred = this.turns.get(conversationId)
    if (preferred && this.resolvePending(preferred, toolCallId, payload)) return true

    // File Preview / multi-window: active conversation may differ from the
    // session that owns the pending tool card — resolve by toolCallId.
    for (const turn of this.turns.values()) {
      if (this.resolvePending(turn, toolCallId, payload)) return true
    }

    // Last resort: sole parked waiter (desynced ids after focus hop / HMR).
    const sole: PendingUserTool[] = []
    for (const turn of this.turns.values()) {
      for (const waiter of turn.pending.values()) sole.push(waiter)
    }
    if (sole.length === 1) {
      sole[0]!.resolve(payload)
      return true
    }
    console.warn(
      '[agent] answer ignored — no pending waiter',
      { conversationId, toolCallId, pendingTurns: this.turns.size, sole: sole.length }
    )
    return false
  }

  private resolvePending(
    turn: TurnState,
    toolCallId: string,
    answer: { text: string; cancelled: boolean }
  ): boolean {
    const waiter = turn.pending.get(toolCallId)
    if (!waiter) return false
    waiter.resolve(answer)
    return true
  }

  private releaseAllPending(
    turn: TurnState,
    answer: { text: string; cancelled: boolean }
  ): void {
    const waiters = [...turn.pending.values()]
    // Clear first so a resolve that re-enters cannot re-list the same waiters.
    turn.pending.clear()
    for (const waiter of waiters) waiter.resolve(answer)
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
            turn.error = describeError(event.message.errorMessage ?? t('error.model'))
          }
        }
        break

      case 'tool_execution_start': {
        // pi emits this *before* beforeToolCall. Do not mark non-interactive tools
        // as executing yet — gateToolCall may park for Approve/Deny, and flipping
        // to "executing" would tear down the approval card (or leave it stuck).
        // Also: never clear an already-open approval (choices) if a late start
        // event races after askUser painted the card.
        const existing = turn.toolState.get(event.toolCallId)
        if (existing?.choices?.length) break
        this.patchTool(conversationId, turn, event.toolCallId, {
          status: 'pending'
        })
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
          const usage = event.message.usage
          const conversation = this.deps.conversations.get(conversationId)
          if (conversation) {
            const turnIndex = (conversation.tokenHistory?.at(-1)?.turnIndex ?? 0) + 1
            const snapshot = buildSnapshot({
              turnIndex,
              usage,
              modelId: conversation.model || event.message.model,
              timestamp: Date.now()
            })
            this.deps.conversations.recordTokenSnapshot(conversationId, snapshot)
            // Context-window fill = this turn's input size (not cumulative session cost).
            // Compact also writes this field so the ring shrinks without a new turn.
            if (snapshot.totalInputTokens > 0) {
              this.deps.conversations.setContextFill(conversationId, snapshot.totalInputTokens)
            }
            const next = this.deps.conversations.get(conversationId)
            if (next) {
              this.deps.emit({
                type: 'usage',
                conversationId,
                tokensUsed: next.tokensUsed,
                tokenLimit: next.tokenLimit,
                history: next.tokenHistory,
                cacheCreatedAt: next.cacheCreatedAt,
                cacheExpiresAt: next.cacheExpiresAt,
                reportedSessionCostUsd: next.reportedSessionCostUsd ?? null
              })
            }
          }
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

      case 'thinking_end':
        this.sealReasoning(turn, turn.slots.get(`${turn.llmTurn}:${event.contentIndex}`))
        break

      case 'toolcall_start':
      case 'toolcall_delta':
      case 'toolcall_end': {
        // pi already optimistic-parses partial JSON into `arguments` on every
        // delta (parseStreamingJson). Surface path/command meta as soon as it
        // appears — waiting for toolcall_end is what made fs_write cards blank.
        const call =
          event.type === 'toolcall_end'
            ? event.toolCall
            : event.partial.content[event.contentIndex]
        if (!call || call.type !== 'toolCall') break

        const args = (call.arguments ?? {}) as Record<string, unknown>
        const summary = summarizeToolInput(call.name as ToolName, args)
        const existingSlot = turn.slots.get(`${turn.llmTurn}:${event.contentIndex}`)
        const prev =
          existingSlot !== undefined && turn.blocks[existingSlot]?.kind === 'toolCall'
            ? (turn.blocks[existingSlot] as ToolCallBlock)
            : null

        if (event.type !== 'toolcall_end') {
          this.emitFileDraft(conversationId, call.name, args)
        }

        // Deltas that only grow `contents` must not rewrite the card — summary
        // is stable once path/command is known, and re-stringifying megabyte
        // bodies would flood IPC.
        if (event.type === 'toolcall_delta' && prev && prev.summary === summary) break

        const block = blockFromContent(
          call,
          (id) => turn.toolState.get(id),
          (name, parsed) => summarizeToolInput(name as ToolName, parsed)
        )
        if (!block || block.kind !== 'toolCall') break

        // While args are still streaming, keep `input` lean (meta only) so the
        // card can show the path without shipping the unfinished file body.
        if (event.type !== 'toolcall_end') {
          block.input = JSON.stringify(leanToolArgs(call.name as ToolName, args), null, 2)
          block.summary = summary
        }

        const slot = this.slotFor(turn, event.contentIndex, block)
        // Flush first: the card must not jump ahead of text already buffered.
        this.flushBuffers(conversationId, turn)
        turn.blocks[slot] = block
        this.sendCard(conversationId, turn, slot, block)
        break
      }
    }
  }

  /** Stable position for one `(llm turn, contentIndex)` pair. */
  private slotFor(turn: TurnState, contentIndex: number, seed: MessageBlock): number {
    const key = `${turn.llmTurn}:${contentIndex}`
    const existing = turn.slots.get(key)
    if (existing !== undefined) return existing
    if (seed.kind !== 'reasoning') this.sealReasoning(turn)
    const slot = turn.blocks.length
    turn.blocks.push(seed)
    turn.slots.set(key, slot)
    if (seed.kind === 'reasoning') turn.reasoningStartedAt.set(slot, Date.now())
    return slot
  }

  private sealReasoning(turn: TurnState, slot?: number): void {
    const now = Date.now()
    const targets = slot !== undefined ? [slot] : [...turn.reasoningStartedAt.keys()]
    for (const index of targets) {
      const block = turn.blocks[index]
      if (!block || block.kind !== 'reasoning' || block.durationMs != null) continue
      const started = turn.reasoningStartedAt.get(index) ?? now
      block.durationMs = Math.max(0, now - started)
    }
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
    // Explicit undefined clears approval fields so the card leaves Approve/Deny UI.
    if ('choices' in patch && patch.choices === undefined) delete state.choices
    if ('multiSelect' in patch && patch.multiSelect === undefined) delete state.multiSelect
    if ('questions' in patch && patch.questions === undefined) delete state.questions
    if ('askTitle' in patch && patch.askTitle === undefined) delete state.askTitle
    turn.toolState.set(toolCallId, state)

    let slot = turn.blocks.findIndex((b) => b.kind === 'toolCall' && b.id === toolCallId)
    if (slot < 0) {
      // Mid-gate patches must still paint; synthesize a card rather than drop UI.
      this.ensureToolBlock(turn, toolCallId, '')
      slot = turn.blocks.findIndex((b) => b.kind === 'toolCall' && b.id === toolCallId)
      if (slot < 0) return
    }
    const prev = turn.blocks[slot] as ToolCallBlock
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

  private emitFileDraft(
    conversationId: string,
    toolName: string,
    args: Record<string, unknown>
  ): void {
    const draft = writeToolDraft(toolName, args)
    if (!draft) return
    const logical = this.deps.files.workingCopies?.logicalPath(draft.path) ?? draft.path
    const payload = this.fileDrafts.next(logical, draft.content)
    if (!payload) return
    this.deps.emit({ type: 'file-draft', conversationId, ...payload })
  }

  // -------------------------------------------------------------------------
  // Tools
  // -------------------------------------------------------------------------

  private toolsFor(conversation: Conversation, turn: TurnState): AgentTool[] {
    const conversationId = conversation.id
    const workdir = this.workdirOf(conversation)
    let tools = createTools({
      workdir,
      settings: () => this.deps.settings.get(),
      files: this.deps.files,
      shell: () => this.shellFor(conversation),
      mirror: (text) => this.deps.emit({ type: 'mirror', conversationId, text }),
      fsChanged: (_parentPath, filePath) => {
        const logical = this.deps.files.workingCopies?.logicalPath(filePath) ?? filePath
        this.deps.emit({
          type: 'fs-changed',
          conversationId,
          parentPath: dirname(logical),
          filePath: logical
        })
      },
      ask: (toolCallId, summary, options) =>
        this.askUser(conversationId, turn, toolCallId, summary, options),
      recordWrite: (filePath, originalContent, newContent) =>
        this.deps.changeSets?.recordWrite(
          conversationId,
          workdir,
          filePath,
          originalContent,
          newContent
        ),
      retrieval: this.deps.retrieval,
      duckdb: this.deps.duckdb,
      webSearch: this.deps.webSearch,
      webFetch: this.deps.webFetch,
      skills: this.deps.skills,
      braveSearchKey: () => this.deps.secrets.get('braveSearch'),
      selectionAnchor: () => turn.selectionRefs,
      defaultDocPath: () => {
        if (!conversation.fileId || !this.deps.fileSessions) return null
        return this.deps.fileSessions.pathForFileId?.(conversation.fileId) ?? null
      },
      isFileReadOnly: () =>
        !!this.deps.conversations.get(conversationId)?.fileReadOnly,
      setFileReadOnly: (readOnly) => this.setConversationFileReadOnly(conversationId, readOnly)
    })
    // Keep fs_write offered in Read mode so the same turn can write after
    // switch_mode; execute-time gates still refuse until Edit is on.
    // web_search / web_fetch always offered (no product kill-switch).
    // Edit-mode approvals may rewrite args after the user edits the card.
    return tools.map((tool) => ({
      ...tool,
      execute: (toolCallId, params, signal, onUpdate) => {
        const live = this.deps.conversations.get(conversationId)
        const readOnly = !!live?.fileReadOnly
        // Defense in depth: refuse writes while the session is still Read.
        if (readOnly && FILE_READONLY_BLOCKED_TOOLS.has(tool.name as ToolName)) {
          return Promise.resolve({
            content: [
              {
                type: 'text' as const,
                text: 'Read-only session: call switch_mode with mode "edit" first (user may need to Approve), or ask them to switch the preview to Edit / convert / Save As.'
              }
            ],
            details: {
              display: '已拦截：当前为 Read 模式 — 先 switch_mode → Edit。',
              failed: true
            }
          })
        }
        if (readOnly && tool.name === 'terminal') {
          const command =
            params && typeof params === 'object' && 'command' in params
              ? String((params as { command: unknown }).command ?? '')
              : ''
          if (command && !isReadonlyTerminalCommand(command)) {
            return Promise.resolve({
              content: [
                {
                  type: 'text' as const,
                  text: `Read-only session: refused non-read-only shell command. Call switch_mode (mode: "edit") first, or use ls/cat/grep/rg/head/tail.\nRefused: ${command}`
                }
              ],
              details: {
                display: `已拦截（Read 模式仅允许只读 shell）：\n$ ${command}`,
                failed: true
              }
            })
          }
        }
        const override = turn.argOverrides.get(toolCallId)
        return tool.execute(toolCallId, (override ?? params) as typeof params, signal, onUpdate)
      }
    }))
  }

  /**
   * Flip file-preview Read/Edit from the agent (`switch_mode`) or shared helper.
   * Returns an error message when the open file cannot edit in-place.
   */
  private setConversationFileReadOnly(
    conversationId: string,
    readOnly: boolean
  ): string | null {
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation) return 'Conversation not found.'
    if (!readOnly) {
      const path =
        conversation.focusedFilePath ||
        (conversation.fileId && this.deps.fileSessions
          ? this.deps.fileSessions.pathForFileId(conversation.fileId)
          : null)
      if (isFileEditLockedPath(path)) {
        return (
          'This format cannot switch to Edit in-place (PDF / HEIC / legacy Office / ZIP). ' +
          'Ask the user to convert or Save As from the preview chrome.'
        )
      }
    }
    if (!!conversation.fileReadOnly === readOnly) return null
    this.deps.conversations.updateMeta(conversationId, { fileReadOnly: readOnly })
    this.deps.onFileReadOnlyChange?.(conversationId, readOnly)
    return null
  }

  /**
   * Tool approval (main-chat.rpml): Auto / Bypass / Edit per conversation.
   * Interactive tools (`request`, `ask_user_question`) park themselves.
   */
  private async gateToolCall(
    conversationId: string,
    turn: TurnState,
    toolCall: { id: string; name: string },
    args: unknown
  ): Promise<{ block: boolean; reason?: string } | undefined> {
    const name = toolCall.name as ToolName
    if (INTERACTIVE_TOOLS.has(name) || name === 'plan' || name === 'wait' || name === 'read_bash_session') {
      return undefined
    }

    const conversation = this.deps.conversations.get(conversationId)
    const mode = conversation?.approvalMode ?? 'auto'

    const command =
      name === 'terminal' && args && typeof args === 'object' && 'command' in args
        ? String((args as { command: unknown }).command ?? '')
        : ''

    // File Preview Read: hard-block write tools / mutating shell before approval UI.
    // switch_mode itself is allowed through so the user can Approve → Edit.
    if (conversation?.fileReadOnly && name !== 'switch_mode') {
      if (FILE_READONLY_BLOCKED_TOOLS.has(name)) {
        return {
          block: true,
          reason:
            'Read-only session: call switch_mode with mode "edit" first (or ask the user to switch / convert / Save As).'
        }
      }
      if (name === 'terminal' && command && !isReadonlyTerminalCommand(command)) {
        return {
          block: true,
          reason: `Read-only session: only read-only shell commands are allowed until Edit (refused: ${command.slice(0, 120)})`
        }
      }
    }

    if (mode === 'bypass') return undefined

    if (mode === 'auto') {
      const highRisk =
        HIGH_RISK_TOOLS.has(name) && !(name === 'terminal' && isReadonlyTerminalCommand(command))
      const readonlyNeedsApproval =
        READONLY_TOOLS.has(name) && !this.deps.settings.get().autoApproveReadonly
      if (!highRisk && !readonlyNeedsApproval) return undefined
    }
    // Edit: every non-interactive tool pauses.

    const block = turn.blocks.find(
      (b): b is ToolCallBlock => b.kind === 'toolCall' && b.id === toolCall.id
    )
    const summary =
      block?.summary ||
      (command
        ? command
        : summarizeToolInput(
            name,
            args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
          ))
    const approveLabel = mode === 'edit' ? t('approval.approveRun') : t('approval.approve')
    const denyLabel = mode === 'edit' ? t('approval.skip') : t('approval.deny')
    const title =
      mode === 'edit'
        ? t('approval.titleEdit', { name })
        : t('approval.title', { name })
    const editable = mode === 'edit' ? summary : ''

    const approval = await this.askUser(conversationId, turn, toolCall.id, `${title}\n${summary}`, {
      choices: [approveLabel, denyLabel],
      // Stash the editable payload in askTitle so the card can prefill a textarea.
      askTitle: mode === 'edit' ? editable : undefined
    })
    if (approval.cancelled) return { block: true, reason: t('approval.userCancelled') }
    if (approval.text === denyLabel || isApprovalDenyText(approval.text)) {
      return { block: true, reason: t('approval.userDenied') }
    }

    // Edit mode: approve-run + edited payload may rewrite terminal command / paths.
    if (mode === 'edit') {
      const edited = approval.text.startsWith(`${approveLabel}\n`)
        ? approval.text.slice(approveLabel.length + 1)
        : isApprovalApproveText(approval.text, true) || approval.text === approveLabel
          ? ''
          : approval.text
      if (edited.trim()) {
        const next = applyEditedArgs(name, args, edited.trim())
        if (next) {
          turn.argOverrides.set(toolCall.id, next)
          if (block) {
            block.summary = summarizeToolInput(name, next)
            block.input = JSON.stringify(next)
            this.sendCard(conversationId, turn, turn.blocks.indexOf(block), block)
          }
        }
      }
    }
    return undefined
  }

  /** Parks the turn until the renderer routes an answer back for this card. */
  private askUser(
    conversationId: string,
    turn: TurnState,
    toolCallId: string,
    summary: string,
    options: {
      choices?: string[]
      multiSelect?: boolean
      questions?: import('@shared/types').AskQuestion[]
      askTitle?: string
    } = {}
  ): Promise<{ text: string; cancelled: boolean }> {
    if (turn.abort.signal.aborted) return Promise.resolve({ text: '', cancelled: true })

    // Ensure a tool card exists even if streaming never claimed a slot for this
    // id (provider id remap / race). Without a slot, patchTool used to no-op
    // and the second Approve/Deny looked dead while the turn stayed parked.
    this.ensureToolBlock(turn, toolCallId, summary)

    this.patchTool(conversationId, turn, toolCallId, {
      status: 'pending',
      choices: options.choices,
      multiSelect: options.multiSelect,
      questions: options.questions,
      askTitle: options.askTitle
    })
    // Refresh summary on the card (title + command body for approvals).
    let slot = turn.blocks.findIndex((b) => b.kind === 'toolCall' && b.id === toolCallId)
    if (slot >= 0 && summary) {
      const block = turn.blocks[slot] as ToolCallBlock
      if (summary !== block.summary) {
        block.summary = summary
        this.sendCard(conversationId, turn, slot, block)
      }
    }
    this.setPhase(conversationId, turn, 'awaiting-user')
    slot = turn.blocks.findIndex((b) => b.kind === 'toolCall' && b.id === toolCallId)
    if (slot >= 0) {
      const block = turn.blocks[slot] as ToolCallBlock
      this.deps.emit({
        type: 'awaiting',
        conversationId,
        toolCallId,
        index: slot,
        block: {
          ...block,
          summary: summary || block.summary,
          choices: options.choices,
          multiSelect: options.multiSelect,
          questions: options.questions,
          askTitle: options.askTitle
        }
      })
    }

    return new Promise((resolve) => {
      // Replace any prior waiter for this id (should not happen under sequential
      // tools, but a leaked waiter would permanently stick the card).
      const prior = turn.pending.get(toolCallId)
      if (prior) {
        try {
          prior.resolve({ text: '', cancelled: true })
        } catch {
          // ignore
        }
      }
      let settled = false
      turn.pending.set(toolCallId, {
        toolCallId,
        resolve: (answer) => {
          if (settled) return
          settled = true
          turn.pending.delete(toolCallId)
          // Leave the approval UI immediately. Previously status stayed `pending`
          // with choices, so Approve looked like a no-op and further clicks
          // hit a cleared pending.
          if (answer.cancelled) {
            this.patchTool(conversationId, turn, toolCallId, {
              status: 'error',
              output: t('approval.userCancelled'),
              choices: undefined,
              multiSelect: undefined,
              questions: undefined,
              askTitle: undefined
            })
          } else {
            this.patchTool(conversationId, turn, toolCallId, {
              status: 'executing',
              choices: undefined,
              multiSelect: undefined,
              questions: undefined,
              askTitle: undefined
            })
          }
          // Only leave awaiting-user when no other card is still parked.
          if (turn.pending.size === 0) {
            this.setPhase(conversationId, turn, 'working')
          }
          resolve(answer)
        }
      })
    })
  }

  /** Guarantee a toolCall block so approval patches always reach the renderer. */
  private ensureToolBlock(turn: TurnState, toolCallId: string, summary: string): void {
    const existing = turn.blocks.findIndex((b) => b.kind === 'toolCall' && b.id === toolCallId)
    if (existing >= 0) return
    const block: ToolCallBlock = {
      kind: 'toolCall',
      id: toolCallId,
      tool: 'terminal',
      summary: summary || toolCallId,
      input: '{}',
      output: '',
      status: 'pending'
    }
    turn.blocks.push(block)
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
      (b) =>
        b.kind === 'toolCall' ||
        b.kind === 'plan' ||
        (b.kind === 'text' && b.text.length > 0) ||
        (b.kind === 'reasoning' && b.text.length > 0)
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
    void this.finishAsync(conversationId, turn)
  }

  private async finishAsync(conversationId: string, turn: TurnState): Promise<void> {
    this.flushBuffers(conversationId, turn)
    if (turn.flushTimer) clearTimeout(turn.flushTimer)
    this.sealReasoning(turn)

    // Seal plan checklist to match turn outcome. Models often finish the work
    // then reply without a last `plan` call — without this the UI stays "paused".
    const planMode: 'cancel' | 'error' | 'success' = turn.cancelled
      ? 'cancel'
      : turn.error
        ? 'error'
        : 'success'
    sealPlanBlocks(turn.blocks, planMode)

    if (turn.cancelled) {
      for (const block of turn.blocks) {
        if (block.kind !== 'toolCall') continue
        if (block.tool === 'plan') continue // already sealed
        if (
          (block.tool === 'ask_user_question' || block.tool === 'request') &&
          block.status === 'pending'
        ) {
          block.status = 'skipped'
          block.output = t('common.cancelled')
          continue
        }
        if (block.status === 'pending' || block.status === 'executing') {
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
      errorText: turn.error,
      errorDetail: turn.error
    })
    this.turns.delete(conversationId)

    const conversation = this.deps.conversations.get(conversationId)
    const parent = conversation?.messages.find((m) => m.id === turn.parentId)
    const turnTitle = parent?.content?.trim() || conversation?.title || 'Agent turn'
    let changeSet =
      (await this.deps.changeSets?.finalizeTurn(
        conversationId,
        turnTitle,
        conversation?.model || '',
        { cancelled: turn.cancelled, error: !!turn.error }
      )) ?? null
    if (changeSet) {
      // Bypass: writes already on disk — auto-accept; no review gate.
      const mode = conversation?.approvalMode ?? 'auto'
      if (mode === 'bypass' && this.deps.changeSets) {
        const accepted = await this.deps.changeSets.acceptAll(changeSet.id)
        if (accepted) changeSet = accepted
      }
      message.changeSetId = changeSet.id
    }

    if (message.blocks.length > 0 || message.changeSetId) {
      this.deps.conversations.replaceMessage(conversationId, message)
    }
    this.deps.conversations.flush()

    this.deps.emit({
      type: 'end',
      conversationId,
      message,
      tokensUsed: conversation?.tokensUsed ?? 0,
      error: turn.error,
      cancelled: turn.cancelled
    })

    // UI notices deferred during the turn (e.g. Discard) — after the assistant leaf.
    this.flushPendingNotices(conversationId)

    if (changeSet) {
      this.deps.emit({
        type: 'change-review',
        conversationId,
        changeSetId: changeSet.id,
        pendingCount: changeSet.files.filter((f) => f.status === 'pending').length,
        messageId: message.id,
        // Ship the full set so the renderer never depends on a later get() for
        // the first paint (and survives remounts while the set is still in memory).
        changeSet
      })
    }
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
      errorText: error,
      errorDetail: error
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

  /** Clear changeSetId on older messages when a new turn begins. */
  private stripPriorChangeSetIds(conversationId: string): void {
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation) return
    let dirty = false
    for (const message of conversation.messages) {
      if (!message.changeSetId) continue
      delete message.changeSetId
      dirty = true
    }
    if (dirty) this.deps.conversations.flush()
  }

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

/**
 * Streaming tool args for the card: keep identity fields, drop bulky bodies.
 * Full arguments land on toolcall_end via {@link blockFromContent}.
 */
function leanToolArgs(tool: ToolName, args: Record<string, unknown>): Record<string, unknown> {
  switch (tool) {
    case 'fs_write': {
      const lean: Record<string, unknown> = {}
      if (typeof args.path === 'string') lean.path = args.path
      if (args.contents !== undefined) lean.contents = '…'
      return lean
    }
    case 'fs_read':
    case 'fs_list': {
      const lean: Record<string, unknown> = {}
      if (typeof args.path === 'string') lean.path = args.path
      return lean
    }
    case 'doc_search': {
      const lean: Record<string, unknown> = {}
      if (typeof args.path === 'string') lean.path = args.path
      if (typeof args.query === 'string') lean.query = args.query
      if (args.related_to_selection !== undefined) {
        lean.related_to_selection = args.related_to_selection
      }
      if (args.top_k !== undefined) lean.top_k = args.top_k
      return lean
    }
    case 'doc_fetch': {
      const lean: Record<string, unknown> = {}
      if (typeof args.path === 'string') lean.path = args.path
      if (args.ids !== undefined) lean.ids = args.ids
      if (args.page !== undefined) lean.page = args.page
      if (args.section_id !== undefined) lean.section_id = args.section_id
      return lean
    }
    case 'web_search': {
      const lean: Record<string, unknown> = {}
      if (typeof args.query === 'string') lean.query = args.query
      if (args.num_results !== undefined) lean.num_results = args.num_results
      if (typeof args.site === 'string') lean.site = args.site
      return lean
    }
    case 'web_fetch': {
      const lean: Record<string, unknown> = {}
      if (typeof args.url === 'string') lean.url = args.url
      if (args.extract !== undefined) lean.extract = args.extract
      if (args.max_chars !== undefined) lean.max_chars = args.max_chars
      if (args.start_line !== undefined) lean.start_line = args.start_line
      return lean
    }
    case 'terminal': {
      const lean: Record<string, unknown> = {}
      if (typeof args.command === 'string') lean.command = args.command
      if (args.background !== undefined) lean.background = args.background
      return lean
    }
    case 'request':
      return typeof args.instruction === 'string' ? { instruction: args.instruction } : {}
    case 'ask_user_question': {
      // Keep choices / multiSelect so the renderer can rebuild single- and
      // multi-select cards from persisted input (not free-text-only).
      const lean: Record<string, unknown> = {}
      if (args.question !== undefined) lean.question = args.question
      if (args.choices !== undefined) lean.choices = args.choices
      if (args.multiSelect !== undefined) lean.multiSelect = args.multiSelect
      if (args.questions !== undefined) lean.questions = args.questions
      if (args.title !== undefined) lean.title = args.title
      return lean
    }
    case 'plan': {
      const lean: Record<string, unknown> = {}
      if (args.title !== undefined) lean.title = args.title
      if (args.steps !== undefined) lean.steps = args.steps
      return lean
    }
    default:
      return args
  }
}

/** Merge a user's edited approval payload back into tool args. */
function applyEditedArgs(
  name: ToolName,
  original: unknown,
  edited: string
): Record<string, unknown> | null {
  const base =
    original && typeof original === 'object' ? { ...(original as Record<string, unknown>) } : {}
  if (name === 'terminal') {
    return { ...base, command: edited }
  }
  if (name === 'fs_read' || name === 'fs_write' || name === 'fs_list') {
    return { ...base, path: edited }
  }
  if (name === 'web_fetch') {
    return { ...base, url: edited }
  }
  if (name === 'web_search') {
    return { ...base, query: edited }
  }
  try {
    const parsed = JSON.parse(edited) as unknown
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    // not JSON
  }
  return null
}

/**
 * Reconcile plan checklist state when a turn ends.
 *
 * Models often complete the work then write a final answer without a last
 * `plan` tool call, leaving steps pending and the UI stuck on "paused".
 * - cancel: executing→error, pending→skipped
 * - error:  executing→error (pending left so the user sees what was not started)
 * - success: any still-open step is treated as finished work the agent forgot
 *   to tick off → done (abandoned work should have been marked skipped mid-turn)
 */
function sealPlanBlocks(
  blocks: MessageBlock[],
  mode: 'cancel' | 'error' | 'success'
): void {
  for (const block of blocks) {
    if (block.kind !== 'toolCall' || block.tool !== 'plan') continue
    const input = safeParseJson(block.input)
    const steps = normalizePlanSteps(input.steps).map((step) => {
      if (mode === 'cancel') {
        if (step.status === 'executing') {
          return { ...step, status: 'error' as const, subtitle: step.subtitle ?? t('common.cancelled') }
        }
        if (step.status === 'pending') {
          return { ...step, status: 'skipped' as const, subtitle: step.subtitle ?? t('common.cancelled') }
        }
        return step
      }
      if (mode === 'error') {
        if (step.status === 'executing') {
          return { ...step, status: 'error' as const, subtitle: step.subtitle ?? t('common.failed') }
        }
        return step
      }
      // success — promote open steps so a completed turn does not show half-checked todos
      if (step.status === 'executing' || step.status === 'pending') {
        return { ...step, status: 'done' as const }
      }
      return step
    })
    const title = String(input.title ?? 'Plan')
    const done = steps.filter((step) => step.status === 'done').length
    block.input = JSON.stringify({ ...input, title, steps }, null, 2)
    block.summary = `Plan · ${title} (${done}/${steps.length})`
    if (block.status === 'pending' || block.status === 'executing') {
      block.status = 'completed'
    }
  }
}
