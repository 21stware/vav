import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type {
  AgentConfig,
  ChatMessage,
  CliHostKind,
  MessageBlock,
  PreviewRef,
  ProviderResumeCursor,
  QuotaWindow,
  QuoteDraft,
  ToolCallBlock,
  TurnEvent,
  TurnPhase,
  TurnStatus
} from '@shared/types'
import { ROOT_LEAF } from '@shared/thread'
import { buildSnapshot } from '@shared/tokenUsage'
import { isApprovalApproveText } from '@shared/i18n'
import { enabledCliAgents, isStructuredCliHost } from '@shared/types'
import type { ConversationStore } from '../store/ConversationStore'
import type { SettingsStore } from '../store/SettingsStore'
import type { ChangeSetStore } from './ChangeSetStore'
import {
  resolveHostBinary,
  startDriver,
  type DriverControl,
  type DriverEvent
} from './drivers'
import { inputJson, mapToolName, summarizeCliTool } from './drivers/toolMap'
import { FileDraftCoalescer, writeToolDraft } from '@shared/writeToolDraft'

const COALESCE_MS = 32

interface PendingPermission {
  requestId: string
  toolCallId: string
  resolve: (decision: 'allow' | 'deny') => void
}

interface HostTurn {
  messageId: string
  parentId: string | null
  phase: TurnPhase
  blocks: MessageBlock[]
  /** Stable slot index for the open text / reasoning block. */
  textIndex: number | null
  reasoningIndex: number | null
  toolIndex: Map<string, number>
  buffers: Map<number, string>
  flushTimer: NodeJS.Timeout | null
  toolCount: number
  cancelled: boolean
  error?: string
  pendingPermissions: Map<string, PendingPermission>
  /** permission requestId → toolCallId for answer routing */
  permissionByRequest: Map<string, string>
}

interface HostRuntime {
  kind: CliHostKind
  driver: DriverControl
  cursor: ProviderResumeCursor | null
  lastTouch: number
}

export interface CliAgentHostDeps {
  conversations: ConversationStore
  settings: SettingsStore
  changeSets?: ChangeSetStore
  emit: (event: TurnEvent) => void
  /** Sandbox copy → user-visible path (for streaming drafts). */
  logicalPath?: (path: string) => string
}

/**
 * Hosts structured CLI agents (Claude / Codex / ACP / OpenCode / Pi) and
 * projects their protocol events onto the same TurnEvent stream the built-in
 * AgentRuntime uses — so Transcript / Composer / ChangeSet stay unchanged.
 */
export class CliAgentHost {
  private runtimes = new Map<string, HostRuntime>()
  private turns = new Map<string, HostTurn>()
  private starting = new Map<string, Promise<HostRuntime>>()
  private fileDrafts = new FileDraftCoalescer()

  constructor(private deps: CliAgentHostDeps) {}

  owns(conversationId: string): boolean {
    const conv = this.deps.conversations.get(conversationId)
    return isStructuredCliHost(conv?.cliHost)
  }

  isRunning(conversationId: string): boolean {
    return this.turns.has(conversationId)
  }

  status(conversationId: string): TurnStatus {
    const turn = this.turns.get(conversationId)
    const awaiting = turn
      ? ([...turn.pendingPermissions.values()][0]?.toolCallId ?? null)
      : null
    return {
      conversationId,
      isRunning: !!turn,
      phase: turn?.phase ?? 'idle',
      toolCount: turn?.toolCount ?? 0,
      awaitingToolCallId: awaiting,
      messageId: turn?.messageId ?? null,
      blocks: turn ? turn.blocks.map((b) => ({ ...b })) : []
    }
  }

  async run(
    conversationId: string,
    userText: string,
    attachments: string[],
    quote?: QuoteDraft | null,
    contextBlocks?: PreviewRef[] | null,
    contextFile?: string | null
  ): Promise<void> {
    if (this.turns.has(conversationId)) return
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation || !isStructuredCliHost(conversation.cliHost)) return

    const openFile = contextFile?.trim() || conversation.focusedFilePath || null
    const leaf = this.deps.conversations.activeLeaf(conversationId)
    const parentId = leaf === ROOT_LEAF ? null : leaf
    const userMessage = this.addUserMessage(
      conversationId,
      userText,
      parentId,
      quote,
      contextBlocks,
      attachments,
      openFile
    )

    const prompt = this.composePrompt(
      userText,
      quote,
      contextBlocks,
      attachments,
      openFile,
      conversation.fileReadOnly === true
    )
    await this.startTurn(conversationId, userMessage.id, userMessage.parentId, prompt)
  }

  async regenerate(conversationId: string, messageId: string): Promise<void> {
    if (this.turns.has(conversationId)) return
    const conversation = this.deps.conversations.get(conversationId)
    const target = conversation?.messages.find((m) => m.id === messageId)
    if (!target || !isStructuredCliHost(conversation?.cliHost)) return
    const parentId = target.role === 'assistant' ? target.parentId : target.id
    this.deps.conversations.setActiveLeaf(conversationId, parentId)
    const path = conversation!.messages
    const parent = parentId ? path.find((m) => m.id === parentId) : null
    const user =
      parent?.role === 'user'
        ? parent
        : path.filter((m) => m.role === 'user').at(-1) ?? null
    if (!user?.content.trim()) return
    const openFile =
      user.contextFile?.trim() || conversation!.focusedFilePath || null
    const prompt = this.composePrompt(
      user.content,
      user.quoteSummary
        ? {
            messageId: user.quoteMessageId ?? user.id,
            summary: user.quoteSummary,
            role: user.quoteRole ?? 'user'
          }
        : null,
      user.contextBlocks,
      user.attachments,
      openFile,
      conversation!.fileReadOnly === true
    )
    await this.startTurn(conversationId, randomUUID(), parentId, prompt)
  }

  async editUserMessage(conversationId: string, messageId: string, text: string): Promise<void> {
    if (this.turns.has(conversationId)) return
    const conversation = this.deps.conversations.get(conversationId)
    const target = conversation?.messages.find((m) => m.id === messageId)
    if (!target || target.role !== 'user' || !text.trim()) return
    if (!isStructuredCliHost(conversation?.cliHost)) return
    const openFile =
      target.contextFile?.trim() || conversation.focusedFilePath || null
    const userMessage = this.addUserMessage(
      conversationId,
      text,
      target.parentId,
      target.quoteSummary
        ? {
            messageId: target.quoteMessageId ?? target.id,
            summary: target.quoteSummary,
            role: target.quoteRole ?? 'user'
          }
        : null,
      target.contextBlocks,
      target.attachments,
      openFile
    )
    const prompt = this.composePrompt(
      text,
      userMessage.quoteSummary
        ? {
            messageId: userMessage.quoteMessageId ?? userMessage.id,
            summary: userMessage.quoteSummary,
            role: userMessage.quoteRole ?? 'user'
          }
        : null,
      userMessage.contextBlocks,
      userMessage.attachments,
      openFile,
      conversation.fileReadOnly === true
    )
    await this.startTurn(conversationId, userMessage.id, userMessage.parentId, prompt)
  }

  cancel(conversationId: string): void {
    const turn = this.turns.get(conversationId)
    const runtime = this.runtimes.get(conversationId)
    if (turn) {
      turn.cancelled = true
      for (const p of turn.pendingPermissions.values()) p.resolve('deny')
      turn.pendingPermissions.clear()
      runtime?.driver.cancel()
      // If the driver has no interrupt, finish locally after a grace period.
      setTimeout(() => {
        if (this.turns.get(conversationId) === turn) {
          void this.finishTurn(conversationId, turn, false)
        }
      }, 1_500)
      return
    }
    runtime?.driver.cancel()
  }

  answer(conversationId: string, toolCallId: string, text: string): boolean {
    const turn = this.turns.get(conversationId)
    if (!turn) {
      // Cross-conversation fallback
      for (const [id, t] of this.turns) {
        if (this.answerOnTurn(id, t, toolCallId, text)) return true
      }
      return false
    }
    return this.answerOnTurn(conversationId, turn, toolCallId, text)
  }

  private answerOnTurn(
    conversationId: string,
    turn: HostTurn,
    toolCallId: string,
    text: string
  ): boolean {
    const pending =
      turn.pendingPermissions.get(toolCallId) ||
      [...turn.pendingPermissions.values()].find((p) => p.toolCallId === toolCallId)
    if (!pending) return false
    const allow = isApprovalApproveText(text, false)
    turn.pendingPermissions.delete(pending.toolCallId)
    const runtime = this.runtimes.get(conversationId)
    runtime?.driver.respond(pending.requestId, allow ? 'allow' : 'deny', text)
    // Update card
    const idx = turn.toolIndex.get(pending.toolCallId)
    if (idx != null) {
      const block = turn.blocks[idx]
      if (block?.kind === 'toolCall') {
        const next: ToolCallBlock = {
          ...block,
          status: allow ? 'executing' : 'skipped',
          output: allow ? 'Approved' : 'Denied',
          choices: undefined
        }
        turn.blocks[idx] = next
        this.deps.emit({ type: 'tool', conversationId, index: idx, block: next })
      }
    }
    this.setPhase(conversationId, turn, 'working')
    pending.resolve(allow ? 'allow' : 'deny')
    return true
  }

  dispose(conversationId: string): void {
    this.cancel(conversationId)
    const runtime = this.runtimes.get(conversationId)
    if (runtime) {
      runtime.driver.dispose()
      this.runtimes.delete(conversationId)
    }
    this.turns.delete(conversationId)
  }

  /** Apply a model change to a live driver; dispose when the transport needs restart. */
  applyModel(conversationId: string, model: string): void {
    const runtime = this.runtimes.get(conversationId)
    if (!runtime) return
    const ok = runtime.driver.applyOptions?.({ model })
    if (ok === false) this.dispose(conversationId)
  }

  disposeAll(): void {
    for (const id of [...this.runtimes.keys()]) this.dispose(id)
  }

  /** Drop idle runtimes (no turn, untouched for 30 min). */
  reapIdle(maxIdleMs = 30 * 60_000): void {
    const now = Date.now()
    for (const [id, runtime] of this.runtimes) {
      if (this.turns.has(id)) continue
      if (now - runtime.lastTouch < maxIdleMs) continue
      runtime.driver.dispose()
      this.runtimes.delete(id)
    }
  }

  // ---------------------------------------------------------------------------

  private async startTurn(
    conversationId: string,
    messageId: string,
    parentId: string | null,
    prompt: string
  ): Promise<void> {
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation || !isStructuredCliHost(conversation.cliHost)) return

    const workdir = conversation.workingDirectory || homedir()
    this.deps.changeSets?.beginTurn(conversationId, workdir)

    const turn: HostTurn = {
      messageId,
      parentId,
      phase: 'thinking',
      blocks: [],
      textIndex: null,
      reasoningIndex: null,
      toolIndex: new Map(),
      buffers: new Map(),
      flushTimer: null,
      toolCount: 0,
      cancelled: false,
      pendingPermissions: new Map(),
      permissionByRequest: new Map()
    }
    // For regenerate we mint a fresh assistant id
    if (!conversation.messages.some((m) => m.id === messageId && m.role === 'user')) {
      turn.messageId = randomUUID()
    } else {
      // Normal send: assistant is a new node under the user message
      turn.parentId = messageId
      turn.messageId = randomUUID()
    }

    this.turns.set(conversationId, turn)
    this.deps.emit({ type: 'start', conversationId })
    this.setPhase(conversationId, turn, 'thinking')

    try {
      const runtime = await this.ensureRuntime(conversationId)
      runtime.lastTouch = Date.now()
      runtime.driver.prompt(prompt)
    } catch (err) {
      turn.error = err instanceof Error ? err.message : String(err)
      void this.finishTurn(conversationId, turn, false)
    }
  }

  private async ensureRuntime(conversationId: string): Promise<HostRuntime> {
    const existing = this.runtimes.get(conversationId)
    if (existing) return existing
    const inflight = this.starting.get(conversationId)
    if (inflight) return inflight

    const promise = this.spawnRuntime(conversationId)
    this.starting.set(conversationId, promise)
    try {
      const runtime = await promise
      this.runtimes.set(conversationId, runtime)
      return runtime
    } finally {
      this.starting.delete(conversationId)
    }
  }

  private async spawnRuntime(conversationId: string): Promise<HostRuntime> {
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation || !isStructuredCliHost(conversation.cliHost)) {
      throw new Error('Conversation is not a structured CLI host')
    }
    const kind = conversation.cliHost
    const settings = this.deps.settings.get()
    const agent = enabledCliAgents(settings.cliAgents).find((a) => a.id === kind) ?? null
    const binary = await resolveHostBinary(kind, agent)
    if (!binary) {
      throw new Error(
        `${kind} CLI not found on PATH. Install it, or open Terminal mode to use a shell.`
      )
    }

    const cwd = conversation.workingDirectory || homedir()
    let cursor = conversation.cliResumeCursor ?? null
    if (cursor && cursor.provider !== kind) cursor = null

    const runtime: HostRuntime = {
      kind,
      driver: null as unknown as DriverControl,
      cursor,
      lastTouch: Date.now()
    }

    const driver = await startDriver(
      kind,
      {
        binary,
        cwd,
        approvalMode: conversation.approvalMode,
        model: conversation.model || null,
        cursor,
        env: agent?.envVars
      },
      (event) => this.onDriverEvent(conversationId, event)
    )
    runtime.driver = driver
    return runtime
  }

  private onDriverEvent(conversationId: string, event: DriverEvent): void {
    const runtime = this.runtimes.get(conversationId)
    if (runtime) runtime.lastTouch = Date.now()

    if (event.type === 'connected') {
      this.deps.conversations.updateMeta(conversationId, {
        cliResumeCursor: event.cursor,
        agentBinaryName: event.cursor.provider
      })
      if (runtime) runtime.cursor = event.cursor
      return
    }

    const turn = this.turns.get(conversationId)
    if (!turn) {
      if (event.type === 'process-exited') {
        this.runtimes.get(conversationId)?.driver.dispose()
        this.runtimes.delete(conversationId)
      }
      return
    }

    switch (event.type) {
      case 'turn-started':
        this.setPhase(conversationId, turn, 'thinking')
        break
      case 'text-delta':
        this.appendDelta(conversationId, turn, 'text', event.text)
        break
      case 'reasoning-delta':
        this.appendDelta(conversationId, turn, 'reasoning', event.text)
        break
      case 'tool':
        this.applyTool(conversationId, turn, event)
        break
      case 'permission':
        this.applyPermission(conversationId, turn, event)
        break
      case 'usage':
        this.applyUsage(conversationId, event)
        break
      case 'quota':
        this.applyQuota(conversationId, event.windows)
        break
      case 'error':
        turn.error = event.message
        break
      case 'turn-finished':
        if (event.resumeAt && runtime?.cursor?.provider === 'claude') {
          const next = {
            provider: 'claude' as const,
            sessionId: runtime.cursor.sessionId,
            resumeAt: event.resumeAt
          }
          runtime.cursor = next
          this.deps.conversations.updateMeta(conversationId, { cliResumeCursor: next })
        }
        if (event.error) turn.error = event.error
        if (!event.success && !turn.cancelled && !turn.error) {
          turn.error = 'Turn failed'
        }
        void this.finishTurn(conversationId, turn, event.success)
        break
      case 'process-exited':
        if (this.turns.has(conversationId)) {
          turn.error = turn.error || `Agent process exited (${event.code ?? '?'})`
          void this.finishTurn(conversationId, turn, false)
        }
        this.runtimes.delete(conversationId)
        break
    }
  }

  private appendDelta(
    conversationId: string,
    turn: HostTurn,
    kind: 'text' | 'reasoning',
    text: string
  ): void {
    if (!text) return
    let index = kind === 'text' ? turn.textIndex : turn.reasoningIndex
    if (index == null) {
      index = turn.blocks.length
      turn.blocks.push(kind === 'text' ? { kind: 'text', text: '' } : { kind: 'reasoning', text: '' })
      if (kind === 'text') turn.textIndex = index
      else turn.reasoningIndex = index
    }
    // Opening a text block after tools — start a new slot
    if (kind === 'text' && turn.toolCount > 0) {
      const last = turn.blocks[turn.blocks.length - 1]
      if (last && last.kind !== 'text') {
        index = turn.blocks.length
        turn.blocks.push({ kind: 'text', text: '' })
        turn.textIndex = index
      }
    }
    const buf = (turn.buffers.get(index) ?? '') + text
    turn.buffers.set(index, buf)
    this.setPhase(conversationId, turn, kind === 'reasoning' ? 'thinking' : 'outputting')
    if (!turn.flushTimer) {
      turn.flushTimer = setTimeout(() => this.flushBuffers(conversationId, turn), COALESCE_MS)
    }
  }

  private flushBuffers(conversationId: string, turn: HostTurn): void {
    turn.flushTimer = null
    for (const [index, text] of turn.buffers) {
      if (!text) continue
      const block = turn.blocks[index]
      if (!block || (block.kind !== 'text' && block.kind !== 'reasoning')) continue
      block.text += text
      turn.buffers.set(index, '')
      this.deps.emit({
        type: 'delta',
        conversationId,
        index,
        kind: block.kind === 'reasoning' ? 'reasoning' : 'text',
        text
      })
    }
  }

  private applyTool(
    conversationId: string,
    turn: HostTurn,
    event: Extract<DriverEvent, { type: 'tool' }>
  ): void {
    this.flushBuffers(conversationId, turn)
    let index = turn.toolIndex.get(event.id)
    if (index == null) {
      index = turn.blocks.length
      turn.toolIndex.set(event.id, index)
      const block: ToolCallBlock = {
        kind: 'toolCall',
        id: event.id,
        tool: mapToolName(event.name),
        summary: summarizeCliTool(event.name, event.input),
        input: inputJson(event.input),
        output: '',
        status: 'pending'
      }
      turn.blocks.push(block)
      // New content after a tool should open fresh text/reasoning slots
      turn.textIndex = null
      turn.reasoningIndex = null
    }
    const block = turn.blocks[index] as ToolCallBlock
    if (event.status === 'started' || event.status === 'updated') {
      block.status = 'executing'
      if (event.input && Object.keys(event.input as object).length) {
        block.input = inputJson(event.input)
        block.summary = summarizeCliTool(event.name, event.input)
        block.tool = mapToolName(event.name)
      }
    } else if (event.status === 'completed') {
      block.status = 'completed'
      block.output = event.output ?? block.output
      turn.toolCount++
    } else if (event.status === 'error') {
      block.status = 'error'
      block.output = event.output ?? block.output
      turn.toolCount++
    }
    turn.blocks[index] = { ...block }
    this.deps.emit({ type: 'tool', conversationId, index, block: { ...block } })
    if (event.status === 'started' || event.status === 'updated') {
      this.emitFileDraft(conversationId, event.name, event.input)
    }
    this.setPhase(conversationId, turn, 'working')
  }

  private emitFileDraft(conversationId: string, toolName: string, input: unknown): void {
    const draft = writeToolDraft(toolName, input)
    if (!draft) return
    const logical = this.deps.logicalPath?.(draft.path) ?? draft.path
    const payload = this.fileDrafts.next(logical, draft.content)
    if (!payload) return
    this.deps.emit({ type: 'file-draft', conversationId, ...payload })
  }

  private applyPermission(
    conversationId: string,
    turn: HostTurn,
    event: Extract<DriverEvent, { type: 'permission' }>
  ): void {
    this.flushBuffers(conversationId, turn)
    const toolCallId = `perm-${event.requestId}`
    const index = turn.blocks.length
    turn.toolIndex.set(toolCallId, index)
    const block: ToolCallBlock = {
      kind: 'toolCall',
      id: toolCallId,
      tool: 'request',
      summary: event.summary || event.toolName,
      input: inputJson(event.input ?? { tool: event.toolName, detail: event.detail }),
      output: '',
      status: 'pending',
      choices: ['Approve', 'Deny'],
      askTitle: event.toolName
    }
    turn.blocks.push(block)
    turn.pendingPermissions.set(toolCallId, {
      requestId: event.requestId,
      toolCallId,
      resolve: () => undefined
    })
    turn.permissionByRequest.set(event.requestId, toolCallId)
    this.deps.emit({ type: 'awaiting', conversationId, toolCallId, index, block })
    this.setPhase(conversationId, turn, 'awaiting-user')
  }

  private applyQuota(conversationId: string, windows: QuotaWindow[]): void {
    if (!windows.length) return
    const changed = this.deps.conversations.mergeQuotaWindows(conversationId, windows)
    if (!changed) return
    this.emitUsageSnapshot(conversationId)
  }

  private emitUsageSnapshot(conversationId: string): void {
    const updated = this.deps.conversations.get(conversationId)
    if (!updated) return
    this.deps.emit({
      type: 'usage',
      conversationId,
      tokensUsed: updated.tokensUsed,
      tokenLimit: updated.tokenLimit,
      history: updated.tokenHistory,
      cacheCreatedAt: updated.cacheCreatedAt,
      cacheExpiresAt: updated.cacheExpiresAt,
      reportedSessionCostUsd: updated.reportedSessionCostUsd ?? null,
      quotaWindows: updated.quotaWindows ?? []
    })
  }

  private applyUsage(
    conversationId: string,
    event: Extract<DriverEvent, { type: 'usage' }>
  ): void {
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation) return

    if (typeof event.contextSize === 'number' && event.contextSize > 0) {
      this.deps.conversations.setTokenLimit(conversationId, event.contextSize)
    }
    if (typeof event.sessionCostUsd === 'number' && Number.isFinite(event.sessionCostUsd)) {
      this.deps.conversations.setReportedSessionCostUsd(conversationId, event.sessionCostUsd)
    }
    let quotaChanged = false
    if (event.quotaWindows?.length) {
      quotaChanged = this.deps.conversations.mergeQuotaWindows(conversationId, event.quotaWindows)
    }

    const input = event.inputTokens ?? 0
    const output = event.outputTokens ?? 0
    const cacheRead = event.cacheRead ?? 0
    const cacheWrite = event.cacheWrite ?? 0
    const hasTurnTokens = input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0
    const recordHistory = event.recordHistory ?? hasTurnTokens

    let snapshotTotal: number | null = null
    if (recordHistory && hasTurnTokens) {
      const live = this.deps.conversations.get(conversationId)!
      const snapshot = buildSnapshot({
        turnIndex: (live.tokenHistory?.length ?? 0) + 1,
        usage: { input, output, cacheRead, cacheWrite },
        modelId: live.model || 'cli',
        costUsd: event.turnCostUsd
      })
      this.deps.conversations.recordTokenSnapshot(conversationId, snapshot)
      snapshotTotal = snapshot.totalInputTokens
    }

    const fill =
      typeof event.contextUsed === 'number' && event.contextUsed >= 0
        ? event.contextUsed
        : snapshotTotal
    if (typeof fill === 'number' && fill >= 0) {
      this.deps.conversations.setContextFill(conversationId, fill)
    }

    // Nothing meaningful changed (e.g. empty usage ping).
    if (
      fill == null &&
      !recordHistory &&
      event.contextSize == null &&
      event.sessionCostUsd == null &&
      !quotaChanged
    ) {
      return
    }
    this.emitUsageSnapshot(conversationId)
  }

  private async finishTurn(
    conversationId: string,
    turn: HostTurn,
    _success: boolean
  ): Promise<void> {
    if (!this.turns.has(conversationId)) return
    // Prevent double-finish from cancel grace + turn-finished race.
    this.turns.delete(conversationId)
    this.flushBuffers(conversationId, turn)

    for (const block of turn.blocks) {
      if (block.kind !== 'toolCall') continue
      if (block.status === 'pending' || block.status === 'executing') {
        block.status = turn.cancelled ? 'expired' : 'skipped'
      }
    }

    const content = turn.blocks
      .filter((b): b is Extract<MessageBlock, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n\n')
      .trim()

    const message: ChatMessage = {
      id: turn.messageId,
      parentId: turn.parentId,
      role: 'assistant',
      content,
      blocks: turn.blocks.map((b) => ({ ...b })),
      createdAt: Date.now(),
      cancelled: turn.cancelled || undefined,
      errorText: turn.error
    }

    let changeSet =
      (await this.deps.changeSets?.finalizeTurn(
        conversationId,
        content.slice(0, 80) || 'CLI agent turn',
        this.deps.conversations.get(conversationId)?.cliHost || 'cli',
        { cancelled: turn.cancelled, error: !!turn.error }
      )) ?? null
    if (changeSet) {
      message.changeSetId = changeSet.id
      const mode = this.deps.conversations.get(conversationId)?.approvalMode
      if (mode === 'bypass' && this.deps.changeSets) {
        const accepted = await this.deps.changeSets.acceptAll(changeSet.id)
        if (accepted) changeSet = accepted
      }
    }

    const existing = this.deps.conversations
      .get(conversationId)
      ?.messages.find((m) => m.id === message.id)
    if (existing) this.deps.conversations.replaceMessage(conversationId, message)
    else this.deps.conversations.appendMessage(conversationId, message)
    this.deps.conversations.flush()

    const tokensUsed = this.deps.conversations.get(conversationId)?.tokensUsed ?? 0

    this.deps.emit({
      type: 'end',
      conversationId,
      message,
      tokensUsed,
      error: turn.error,
      cancelled: turn.cancelled || undefined
    })

    if (changeSet && this.deps.conversations.get(conversationId)?.approvalMode !== 'bypass') {
      this.deps.emit({
        type: 'change-review',
        conversationId,
        changeSetId: changeSet.id,
        pendingCount: changeSet.files.filter((f) => f.status === 'pending').length,
        messageId: message.id,
        changeSet
      })
    }
  }

  private setPhase(conversationId: string, turn: HostTurn, phase: TurnPhase): void {
    if (turn.phase === phase) return
    turn.phase = phase
    this.deps.emit({ type: 'phase', conversationId, phase })
  }

  private addUserMessage(
    conversationId: string,
    text: string,
    parentId: string | null,
    quote?: QuoteDraft | null,
    contextBlocks?: PreviewRef[] | null,
    attachments?: string[],
    contextFile?: string | null
  ): ChatMessage {
    const message: ChatMessage = {
      id: randomUUID(),
      parentId,
      role: 'user',
      content: text,
      blocks: [{ kind: 'text', text }],
      createdAt: Date.now(),
      quoteMessageId: quote?.messageId,
      quoteSummary: quote?.summary,
      quoteRole: quote?.role,
      contextBlocks: contextBlocks ?? undefined,
      attachments: attachments?.length ? attachments : undefined,
      contextFile: contextFile ?? undefined
    }
    this.deps.conversations.appendMessage(conversationId, message)
    this.deps.conversations.flush()
    this.deps.emit({ type: 'user', conversationId, message })
    return message
  }

  private composePrompt(
    text: string,
    quote?: QuoteDraft | null,
    contextBlocks?: PreviewRef[] | null,
    attachments?: string[],
    contextFile?: string | null,
    fileReadOnly = false
  ): string {
    const parts: string[] = []
    if (contextFile) {
      parts.push(
        fileReadOnly
          ? `[Open file — read only]\n${contextFile}`
          : `[Open file]\n${contextFile}`
      )
    }
    if (contextBlocks?.length) {
      for (const ref of contextBlocks) {
        parts.push(
          `[Selection ${ref.filePath}:${ref.startLine}-${ref.endLine}]\n${ref.text}${
            ref.comment ? `\n(comment: ${ref.comment})` : ''
          }`
        )
      }
    }
    if (attachments?.length) {
      parts.push(`[Attachments]\n${attachments.map((a) => `- ${a}`).join('\n')}`)
    }
    if (quote?.summary) {
      parts.push(`[Quoted ${quote.role} message]\n${quote.summary}`)
    }
    parts.push(text)
    return parts.join('\n\n')
  }
}

/** Resolve AgentConfig for a host kind from settings. */
export function agentConfigForHost(
  kind: CliHostKind,
  cliAgents: AgentConfig[] | null | undefined
): AgentConfig | null {
  return enabledCliAgents(cliAgents).find((a) => a.id === kind) ?? null
}
