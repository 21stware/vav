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
import {
  cursorAuthIdentity,
  isStructuredCliHost,
  withCursorAuthIdentity
} from '@shared/cliHost'
import { ROOT_LEAF } from '@shared/thread'
import { buildSnapshot, formatExpiry, mergeQuotaWindowsPreferNewer } from '@shared/tokenUsage'
import {
  classifyCliError,
  extractRpcError,
  formatErrorDetail,
  formatErrorDetailFromParts,
  isBareInternalError,
  pickExhaustedQuotaWindow,
  quotaKindMessageKey,
  shouldRetryFreshSession,
  type CliErrorKind
} from '@shared/cliErrors'
import { en, isApprovalApproveText, isApprovalDenyText, zhCN } from '@shared/i18n'
import { normalizeAskQuestions, parseToolInput } from '@shared/askPlan'
import {
  isAskToolName,
  isPlanDocToolName,
  normalizePlanDocInput,
  planDocHasBody,
  planDocSummary,
  planDocToChecklistInput,
  projectChecklistInput
} from '@shared/planDoc'
import { enabledCliAgents } from '@shared/types'
import { currentLocale, t } from '../i18n'
import { readHostAuthIdentity } from './hostAuth'
import type { ConversationStore } from '../store/ConversationStore'
import type { SettingsStore } from '../store/SettingsStore'
import type { ChangeSetStore } from './ChangeSetStore'
import {
  resolveHostBinary,
  startDriver,
  type DriverControl,
  type DriverEvent
} from './drivers'
import { shouldReplaceCliRuntime } from './cliWorkspaceRestart'
import { createCliHistoryReplayGate, type CliHistoryReplayGate } from './cliHistoryReplay'
import { inputJson, mapToolName, summarizeCliTool } from './drivers/toolMap'
import { FileDraftCoalescer, writeToolDraft } from '@shared/writeToolDraft'
import {
  expireOpenTools,
  findToolBlock,
  snapshotToolBlock,
  topLevelToolIndex
} from '@shared/subtask'

const COALESCE_MS = 32

function describeCliHostError(
  raw: string,
  windows: QuotaWindow[],
  code?: number | null
): { kind: CliErrorKind; message: string } {
  const text = raw.trim() || 'Internal error'
  const locale = currentLocale()
  const kind = classifyCliError(text, windows, code)
  if (kind === 'cancelled') return { kind, message: text }
  if (kind === 'quota') {
    const window = pickExhaustedQuotaWindow(windows)
    if (window) {
      const name = t(quotaKindMessageKey(window.kind))
      const percent = window.usedPercent.toFixed(window.usedPercent >= 10 ? 0 : 1)
      if (window.resetsAt != null) {
        return {
          kind,
          message: t('error.quotaExceededReset', {
            window: name,
            percent,
            clock: formatExpiry(window.resetsAt, Date.now(), locale)
          })
        }
      }
      return { kind, message: t('error.quotaExceeded', { window: name, percent }) }
    }
    return { kind, message: t('error.quotaExceededGeneric') }
  }
  if (kind === 'session-stale') return { kind, message: t('error.sessionStale') }
  if (kind === 'auth') return { kind, message: t('error.agentAuthRequired') }
  if (isBareInternalError(text)) return { kind: 'generic', message: t('error.agentInternal') }
  return { kind, message: text }
}

interface PendingPermission {
  requestId: string
  toolCallId: string
  kind: 'permission' | 'plan_doc' | 'ask'
  /** True when we parked a host tool_use that has no RPC to answer. */
  synthetic?: boolean
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
  errorKind?: CliErrorKind
  errorCode?: number | null
  errorDetail?: string
  prompt: string
  sawTurnStarted: boolean
  retriedFreshSession: boolean
  settling: boolean
  pendingPermissions: Map<string, PendingPermission>
  reasoningStartedAt: Map<number, number>
  /** permission requestId → toolCallId for answer routing */
  permissionByRequest: Map<string, string>
  /** Parent task ids with nested transcript waiting to emit. */
  nestedDirty: Set<string>
  /**
   * Drops the previous assistant turn when an ACP host replays it at the
   * start of the next prompt (Grok session/update dump).
   */
  replay: CliHistoryReplayGate
}

interface HostRuntime {
  kind: CliHostKind
  driver: DriverControl
  /** Directory the driver process was spawned in. */
  cwd: string
  cursor: ProviderResumeCursor | null
  authIdentity: string | null
  lastTouch: number
}

export interface CliAgentHostDeps {
  conversations: ConversationStore
  settings: SettingsStore
  changeSets?: ChangeSetStore
  emit: (event: TurnEvent) => void
  /** Sandbox copy → user-visible path (for streaming drafts). */
  logicalPath?: (path: string) => string
  quota?: {
    get(host: CliHostKind): QuotaWindow[]
    forceRefresh(host: CliHostKind): Promise<QuotaWindow[]>
  }
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
  /** Ignore the next process-exited for this conversation (runtime replace). */
  private ignoreNextExit = new Set<string>()
  /**
   * Bumped when the conversation root changes mid-spawn so {@link spawnUntilCurrent}
   * discards the process that still has the old cwd.
   */
  private cwdEpoch = new Map<string, number>()

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
    const allow =
      pending.kind === 'ask'
        ? !isAskCancelText(text)
        : pending.kind === 'plan_doc'
          ? !isPlanDocRejectText(text)
          : isApprovalApproveText(text, false)
    turn.pendingPermissions.delete(pending.toolCallId)
    const runtime = this.runtimes.get(conversationId)
    if (pending.synthetic) {
      runtime?.driver.steer?.(text)
    } else {
      runtime?.driver.respond(pending.requestId, allow ? 'allow' : 'deny', text)
    }
    const idx = turn.toolIndex.get(pending.toolCallId)
    if (idx != null) {
      const block = turn.blocks[idx]
      if (block?.kind === 'toolCall') {
        const next: ToolCallBlock = {
          ...block,
          status: allow ? (pending.kind === 'permission' ? 'executing' : 'completed') : 'skipped',
          output:
            pending.kind === 'ask'
              ? text
              : pending.kind === 'plan_doc'
                ? allow
                  ? t('planDoc.accepted')
                  : t('planDoc.rejected')
                : allow
                  ? 'Approved'
                  : 'Denied',
          choices: undefined
        }
        turn.blocks[idx] = next
        this.deps.emit({ type: 'tool', conversationId, index: idx, block: next })
        if (allow && pending.kind === 'plan_doc') {
          this.seedChecklistFromPlanDoc(conversationId, turn, next)
        }
      }
    }
    this.setPhase(conversationId, turn, 'working')
    pending.resolve(allow ? 'allow' : 'deny')
    return true
  }

  dispose(conversationId: string): void {
    this.cancel(conversationId)
    this.disposeRuntime(conversationId)
    this.turns.delete(conversationId)
    this.cwdEpoch.delete(conversationId)
  }

  /** Apply a model change to a live driver; dispose when the transport needs restart. */
  applyModel(conversationId: string, model: string): void {
    const runtime = this.runtimes.get(conversationId)
    if (!runtime) return
    const ok = runtime.driver.applyOptions?.({ model })
    if (ok === false) this.dispose(conversationId)
  }

  /**
   * Conversation root changed. Live drivers and resume cursors belong to the
   * old workspace — the next turn must spawn a fresh session in `cwd`.
   */
  setWorkingDirectory(conversationId: string, cwd: string): void {
    const wanted = cwd || homedir()
    const runtime = this.runtimes.get(conversationId)
    if (!shouldReplaceCliRuntime(runtime?.cwd, wanted, this.starting.has(conversationId))) {
      return
    }

    this.cwdEpoch.set(conversationId, (this.cwdEpoch.get(conversationId) ?? 0) + 1)
    this.clearResumeCursor(conversationId)
    if (this.turns.has(conversationId)) this.cancel(conversationId)
    this.disposeRuntime(conversationId, { replacing: true })
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

    const workdir = this.conversationCwd(conversationId)
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
      prompt,
      sawTurnStarted: false,
      retriedFreshSession: false,
      settling: false,
      pendingPermissions: new Map(),
      reasoningStartedAt: new Map(),
      permissionByRequest: new Map(),
      nestedDirty: new Set(),
      replay: createCliHistoryReplayGate(conversation.messages)
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
      const extracted = extractRpcError(err)
      const described = await this.describeTurnError(
        conversationId,
        extracted.text || (err instanceof Error ? err.message : String(err)),
        extracted.code
      )
      turn.error = described.message
      turn.errorKind = described.kind
      turn.errorDetail = formatErrorDetail(err, extracted.text)
      void this.finishTurn(conversationId, turn, false)
    }
  }

  private conversationCwd(conversationId: string): string {
    return this.deps.conversations.get(conversationId)?.workingDirectory || homedir()
  }

  private async ensureRuntime(conversationId: string): Promise<HostRuntime> {
    const wanted = this.conversationCwd(conversationId)
    const existing = this.runtimes.get(conversationId)
    if (existing) {
      const identity = await readHostAuthIdentity(existing.kind)
      const authChanged = !!(
        identity &&
        existing.authIdentity &&
        existing.authIdentity !== identity
      )
      const cwdChanged = existing.cwd !== wanted
      if (cwdChanged || authChanged) {
        if (cwdChanged) {
          this.cwdEpoch.set(
            conversationId,
            (this.cwdEpoch.get(conversationId) ?? 0) + 1
          )
        }
        this.clearResumeCursor(conversationId)
        this.disposeRuntime(conversationId, { replacing: true })
      } else {
        return existing
      }
    }
    const inflight = this.starting.get(conversationId)
    if (inflight) return inflight

    const promise = this.spawnUntilCurrent(conversationId)
    this.starting.set(conversationId, promise)
    try {
      const runtime = await promise
      this.runtimes.set(conversationId, runtime)
      return runtime
    } finally {
      this.starting.delete(conversationId)
    }
  }

  /** Spawn, retrying when {@link setWorkingDirectory} invalidates this attempt. */
  private async spawnUntilCurrent(conversationId: string): Promise<HostRuntime> {
    for (;;) {
      const epoch = this.cwdEpoch.get(conversationId) ?? 0
      const runtime = await this.spawnRuntime(conversationId)
      if ((this.cwdEpoch.get(conversationId) ?? 0) === epoch) return runtime
      this.ignoreNextExit.add(conversationId)
      runtime.driver.dispose()
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

    const cwd = this.conversationCwd(conversationId)
    const identity = await readHostAuthIdentity(kind)
    let cursor = conversation.cliResumeCursor ?? null
    if (cursor && cursor.provider !== kind) cursor = null
    const cursorIdentity = cursorAuthIdentity(cursor)
    if (cursor && identity && cursorIdentity && cursorIdentity !== identity) {
      cursor = null
      this.clearResumeCursor(conversationId)
    }

    const runtime: HostRuntime = {
      kind,
      driver: null as unknown as DriverControl,
      cwd,
      cursor,
      authIdentity: identity,
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
      const cursor = withCursorAuthIdentity(event.cursor, runtime?.authIdentity ?? null)
      this.deps.conversations.updateMeta(conversationId, {
        cliResumeCursor: cursor,
        agentBinaryName: event.cursor.provider
      })
      if (runtime) runtime.cursor = cursor
      return
    }

    const turn = this.turns.get(conversationId)
    if (!turn) {
      if (event.type === 'process-exited') {
        if (this.ignoreNextExit.delete(conversationId)) return
        this.runtimes.get(conversationId)?.driver.dispose()
        this.runtimes.delete(conversationId)
      }
      return
    }

    switch (event.type) {
      case 'turn-started':
        turn.sawTurnStarted = true
        this.setPhase(conversationId, turn, 'thinking')
        break
      case 'text-delta':
        if (turn.replay.text(event.text) === 'skip') break
        if (event.parentId) this.appendNestedDelta(conversationId, turn, event.parentId, 'text', event.text)
        else this.appendDelta(conversationId, turn, 'text', event.text)
        break
      case 'reasoning-delta':
        if (turn.replay.reasoning(event.text) === 'skip') break
        if (event.parentId) {
          this.appendNestedDelta(conversationId, turn, event.parentId, 'reasoning', event.text)
        } else {
          this.appendDelta(conversationId, turn, 'reasoning', event.text)
        }
        break
      case 'tool':
        if (turn.replay.tool(event.id, event.parentId) === 'skip') break
        this.applyTool(conversationId, turn, event)
        break
      case 'permission':
        if (turn.replay.isHistoricalTool(event.requestId)) break
        this.applyPermission(conversationId, turn, event)
        break
      case 'elicitation':
        if (turn.replay.isHistoricalTool(event.toolCallId)) break
        this.applyElicitation(conversationId, turn, event)
        break
      case 'usage':
        this.applyUsage(conversationId, event)
        break
      case 'quota':
        this.applyQuota(conversationId, event.windows)
        break
      case 'error':
        if (
          turn.cancelled ||
          classifyCliError(event.message, this.quotaWindowsFor(conversationId), event.errorCode) ===
            'cancelled'
        ) {
          turn.cancelled = true
          break
        }
        turn.error = event.message
        turn.errorCode = event.errorCode ?? turn.errorCode
        turn.errorDetail = event.errorDetail ?? turn.errorDetail
        if (!turn.sawTurnStarted) {
          void this.settleFailedTurn(
            conversationId,
            turn,
            event.message,
            event.errorCode,
            event.errorDetail
          )
        }
        break
      case 'turn-finished':
        if (event.resumeAt && runtime?.cursor?.provider === 'claude') {
          const next = withCursorAuthIdentity(
            {
              provider: 'claude',
              sessionId: runtime.cursor.sessionId,
              resumeAt: event.resumeAt
            },
            runtime.authIdentity
          )
          runtime.cursor = next
          this.deps.conversations.updateMeta(conversationId, { cliResumeCursor: next })
        }
        if (event.error) {
          turn.error = turn.error || event.error
          turn.errorCode = event.errorCode ?? turn.errorCode
          turn.errorDetail = event.errorDetail ?? turn.errorDetail
        }
        const finishKind = classifyCliError(
          event.error || turn.error || '',
          this.quotaWindowsFor(conversationId),
          event.errorCode ?? turn.errorCode
        )
        // Payment / quota must win over stopReason=cancelled so we keep the
        // resume cursor instead of treating the thread as user-aborted.
        if (finishKind !== 'quota' && (event.cancelled || finishKind === 'cancelled')) {
          turn.cancelled = true
        }
        if (event.success || turn.cancelled) {
          if (event.error && !turn.cancelled) turn.error = event.error
          void this.finishTurn(conversationId, turn, event.success)
          break
        }
        void this.settleFailedTurn(
          conversationId,
          turn,
          event.error || turn.error || t('error.model'),
          event.errorCode ?? turn.errorCode,
          event.errorDetail ?? turn.errorDetail
        )
        break
      case 'process-exited':
        if (this.ignoreNextExit.delete(conversationId)) return
        if (this.turns.has(conversationId)) {
          if (!turn.cancelled) {
            turn.error = turn.error || `Agent process exited (${event.code ?? '?'})`
            turn.errorDetail =
              turn.errorDetail || formatErrorDetailFromParts(turn.error, event.code)
          }
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
      if (kind === 'text') this.sealOpenReasoning(turn)
      index = turn.blocks.length
      turn.blocks.push(kind === 'text' ? { kind: 'text', text: '' } : { kind: 'reasoning', text: '' })
      if (kind === 'text') turn.textIndex = index
      else {
        turn.reasoningIndex = index
        turn.reasoningStartedAt.set(index, Date.now())
      }
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

  private sealOpenReasoning(turn: HostTurn): void {
    const now = Date.now()
    for (const [index, started] of turn.reasoningStartedAt) {
      const block = turn.blocks[index]
      if (!block || block.kind !== 'reasoning' || block.durationMs != null) continue
      block.durationMs = Math.max(0, now - started)
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
    if (turn.nestedDirty.size) {
      const ids = [...turn.nestedDirty]
      turn.nestedDirty.clear()
      for (const id of ids) {
        const parent = findToolBlock(turn.blocks, id)
        if (parent) this.emitParentTool(conversationId, turn, parent)
      }
    }
  }

  private applyTool(
    conversationId: string,
    turn: HostTurn,
    event: Extract<DriverEvent, { type: 'tool' }>
  ): void {
    this.flushBuffers(conversationId, turn)
    if (event.parentId && event.parentId !== event.id) {
      this.applyNestedTool(conversationId, turn, event)
      return
    }
    let index = turn.toolIndex.get(event.id)
    if (index == null) {
      index = turn.blocks.length
      turn.toolIndex.set(event.id, index)
      const block: ToolCallBlock = {
        kind: 'toolCall',
        id: event.id,
        tool: mapToolName(event.name),
        summary: event.title || summarizeCliTool(event.name, event.input) || event.name,
        input: inputJson(event.input),
        output: '',
        status: 'pending'
      }
      turn.blocks.push(block)
      // New content after a tool should open fresh text/reasoning slots
      this.sealOpenReasoning(turn)
      turn.textIndex = null
      turn.reasoningIndex = null
    }
    const block = turn.blocks[index] as ToolCallBlock
    if (block.tool === 'plan') {
      block.input = inputJson(projectChecklistInput(parseToolInput(block.input)))
    }
    this.patchToolBlock(block, event)
    if (block.tool === 'plan' && event.input && Object.keys(event.input as object).length) {
      block.input = inputJson(projectChecklistInput(event.input))
    }
    if (event.status === 'completed' || event.status === 'error') {
      turn.toolCount++
      turn.pendingPermissions.delete(block.id)
    }
    const next = snapshotToolBlock(block)
    turn.blocks[index] = next
    this.deps.emit({ type: 'tool', conversationId, index, block: next })
    if (event.status === 'started' || event.status === 'updated') {
      this.emitFileDraft(conversationId, event.name, event.input)
    }
    if (this.parkInteractiveTool(conversationId, turn, event, next, index)) return
    this.setPhase(conversationId, turn, 'working')
  }

  private applyNestedTool(
    conversationId: string,
    turn: HostTurn,
    event: Extract<DriverEvent, { type: 'tool' }>
  ): void {
    const parent = this.ensureParentTask(turn, event.parentId!)
    parent.children ??= []
    let child = findToolBlock(parent.children, event.id)
    if (!child) {
      child = {
        kind: 'toolCall',
        id: event.id,
        tool: mapToolName(event.name),
        summary: event.title || summarizeCliTool(event.name, event.input) || event.name,
        input: inputJson(event.input),
        output: '',
        status: 'pending'
      }
      parent.children.push(child)
    }
    this.patchToolBlock(child, event)
    this.emitParentTool(conversationId, turn, parent)
    if (event.status === 'started' || event.status === 'updated') {
      this.emitFileDraft(conversationId, event.name, event.input)
    }
    this.setPhase(conversationId, turn, 'working')
  }

  private patchToolBlock(
    block: ToolCallBlock,
    event: Extract<DriverEvent, { type: 'tool' }>
  ): void {
    if (event.status === 'started' || event.status === 'updated') {
      const parked = block.status === 'pending' && (block.tool === 'plan_doc' || block.tool === 'ask_user_question')
      if (!parked) block.status = 'executing'
      if (event.input && Object.keys(event.input as object).length) {
        block.input = inputJson(event.input)
        block.summary = event.title || summarizeCliTool(event.name, event.input) || event.name
        // ACP tool_call_update is a patch and may omit name/kind — never regress
        // a specific mapping back to 'external' on a sparse update.
        const mapped = mapToolName(event.name)
        if (mapped !== 'external' || block.tool === 'external') block.tool = mapped
      } else if (event.title) {
        block.summary = event.title
      }
    } else if (event.status === 'completed') {
      block.status = 'completed'
      block.output = event.output ?? block.output
    } else if (event.status === 'error') {
      block.status = 'error'
      block.output = event.output ?? block.output
    }
  }

  private ensureParentTask(turn: HostTurn, parentId: string): ToolCallBlock {
    const existing = findToolBlock(turn.blocks, parentId)
    if (existing) return existing
    const block: ToolCallBlock = {
      kind: 'toolCall',
      id: parentId,
      tool: 'task',
      summary: t('tool.task'),
      input: '{}',
      output: '',
      status: 'executing',
      children: []
    }
    turn.toolIndex.set(parentId, turn.blocks.length)
    turn.blocks.push(block)
    this.sealOpenReasoning(turn)
    turn.textIndex = null
    turn.reasoningIndex = null
    return block
  }

  private appendNestedDelta(
    conversationId: string,
    turn: HostTurn,
    parentId: string,
    kind: 'text' | 'reasoning',
    text: string
  ): void {
    if (!text) return
    const parent = this.ensureParentTask(turn, parentId)
    parent.children ??= []
    const last = parent.children[parent.children.length - 1]
    if (last && last.kind === kind) {
      last.text += text
    } else {
      parent.children.push(kind === 'text' ? { kind: 'text', text } : { kind: 'reasoning', text })
    }
    turn.nestedDirty.add(parent.id)
    this.setPhase(conversationId, turn, kind === 'reasoning' ? 'thinking' : 'working')
    if (!turn.flushTimer) {
      turn.flushTimer = setTimeout(() => this.flushBuffers(conversationId, turn), COALESCE_MS)
    }
  }

  private emitParentTool(conversationId: string, turn: HostTurn, parent: ToolCallBlock): void {
    const index = topLevelToolIndex(turn.blocks, parent.id) ?? turn.toolIndex.get(parent.id)
    if (index == null) return
    const top = turn.blocks[index]
    if (!top || top.kind !== 'toolCall') return
    const next = snapshotToolBlock(top)
    turn.blocks[index] = next
    this.deps.emit({ type: 'tool', conversationId, index, block: next })
  }

  private emitFileDraft(conversationId: string, toolName: string, input: unknown): void {
    const draft = writeToolDraft(toolName, input)
    if (!draft) return
    const logical = this.deps.logicalPath?.(draft.path) ?? draft.path
    const payload = this.fileDrafts.next(logical, draft.content)
    if (!payload) return
    this.deps.emit({ type: 'file-draft', conversationId, ...payload })
  }

  /** Park ask / plan-doc tool cards until the user answers (any host). */
  private parkInteractiveTool(
    conversationId: string,
    turn: HostTurn,
    event: Extract<DriverEvent, { type: 'tool' }>,
    block: ToolCallBlock,
    index: number
  ): boolean {
    if (event.status === 'completed' || event.status === 'error') return false
    if (turn.pendingPermissions.has(block.id)) return false
    const parsed = parseToolInput(block.input)
    if (block.tool === 'ask_user_question') {
      const questions = normalizeAskQuestions(parsed)
      if (questions.length === 0) return false
      const next: ToolCallBlock = {
        ...block,
        status: 'pending',
        questions,
        askTitle: event.title || String(parsed.title ?? parsed.header ?? '') || block.askTitle
      }
      turn.blocks[index] = next
      turn.pendingPermissions.set(block.id, {
        requestId: block.id,
        toolCallId: block.id,
        kind: 'ask',
        synthetic: true,
        resolve: () => undefined
      })
      this.deps.emit({
        type: 'awaiting',
        conversationId,
        toolCallId: block.id,
        index,
        block: next
      })
      this.setPhase(conversationId, turn, 'awaiting-user')
      return true
    }
    if (block.tool === 'plan_doc') {
      const doc = normalizePlanDocInput(parsed)
      if (!isPlanDocToolName(event.name) && !planDocHasBody(doc)) return false
      const next: ToolCallBlock = { ...block, status: 'pending' }
      turn.blocks[index] = next
      turn.pendingPermissions.set(block.id, {
        requestId: block.id,
        toolCallId: block.id,
        kind: 'plan_doc',
        synthetic: true,
        resolve: () => undefined
      })
      this.deps.emit({
        type: 'awaiting',
        conversationId,
        toolCallId: block.id,
        index,
        block: next
      })
      this.setPhase(conversationId, turn, 'awaiting-user')
      return true
    }
    return false
  }

  private applyElicitation(
    conversationId: string,
    turn: HostTurn,
    event: Extract<DriverEvent, { type: 'elicitation' }>
  ): void {
    this.flushBuffers(conversationId, turn)
    const tool: ToolCallBlock['tool'] = event.kind === 'plan_doc' ? 'plan_doc' : 'ask_user_question'
    const parsed = event.input && typeof event.input === 'object' ? (event.input as Record<string, unknown>) : {}
    const questions = event.kind === 'ask' ? normalizeAskQuestions(parsed) : undefined
    const summary =
      event.kind === 'plan_doc'
        ? planDocSummary(normalizePlanDocInput(event.input))
        : event.title || questions?.[0]?.question || t('tool.ask')
    let index = turn.toolIndex.get(event.toolCallId)
    if (index == null) {
      for (const [id, pending] of turn.pendingPermissions) {
        if (pending.kind !== event.kind) continue
        const found = turn.toolIndex.get(id)
        if (found == null) continue
        index = found
        turn.toolIndex.set(event.toolCallId, found)
        turn.pendingPermissions.delete(id)
        break
      }
    }
    let block: ToolCallBlock
    if (index == null) {
      index = turn.blocks.length
      turn.toolIndex.set(event.toolCallId, index)
      block = {
        kind: 'toolCall',
        id: event.toolCallId,
        tool,
        summary,
        input: inputJson(event.input),
        output: '',
        status: 'pending',
        questions,
        askTitle: event.title
      }
      turn.blocks.push(block)
      this.sealOpenReasoning(turn)
      turn.textIndex = null
      turn.reasoningIndex = null
    } else {
      const current = turn.blocks[index]
      if (!current || current.kind !== 'toolCall') return
      block = {
        ...current,
        tool,
        summary: summary || current.summary,
        input: inputJson(event.input),
        status: 'pending',
        questions,
        askTitle: event.title ?? current.askTitle
      }
      turn.blocks[index] = block
    }
    turn.pendingPermissions.set(block.id, {
      requestId: event.requestId,
      toolCallId: block.id,
      kind: event.kind,
      resolve: () => undefined
    })
    this.deps.emit({
      type: 'awaiting',
      conversationId,
      toolCallId: block.id,
      index,
      block
    })
    this.setPhase(conversationId, turn, 'awaiting-user')
  }

  private seedChecklistFromPlanDoc(
    conversationId: string,
    turn: HostTurn,
    block: ToolCallBlock
  ): void {
    const doc = normalizePlanDocInput(parseToolInput(block.input))
    if (doc.todos.length === 0) return
    this.applyTool(conversationId, turn, {
      type: 'tool',
      id: `${block.id}-todos`,
      name: 'plan',
      input: planDocToChecklistInput(doc),
      status: 'updated'
    })
  }

  private applyPermission(
    conversationId: string,
    turn: HostTurn,
    event: Extract<DriverEvent, { type: 'permission' }>
  ): void {
    this.flushBuffers(conversationId, turn)
    if (isAskToolName(event.toolName) || isPlanDocToolName(event.toolName)) {
      this.applyElicitation(conversationId, turn, {
        type: 'elicitation',
        requestId: event.requestId,
        toolCallId: event.requestId,
        kind: isPlanDocToolName(event.toolName) ? 'plan_doc' : 'ask',
        title: event.summary,
        input: event.input ?? { detail: event.detail, tool: event.toolName }
      })
      return
    }
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
      kind: 'permission',
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
    this.sealOpenReasoning(turn)

    expireOpenTools(turn.blocks, turn.cancelled)

    const content = turn.blocks
      .filter((b): b is Extract<MessageBlock, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n\n')
      .trim()

    if (turn.cancelled) {
      if (classifyCliError(turn.error || '', null, turn.errorCode) === 'quota') {
        turn.cancelled = false
      } else {
        turn.error = undefined
        turn.errorKind = undefined
        turn.errorDetail = undefined
      }
    }

    const message: ChatMessage = {
      id: turn.messageId,
      parentId: turn.parentId,
      role: 'assistant',
      content,
      blocks: turn.blocks.map((b) => ({ ...b })),
      createdAt: Date.now(),
      cancelled: turn.cancelled || undefined,
      errorText: turn.error,
      errorDetail: turn.errorDetail
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
      errorKind: turn.errorKind,
      errorDetail: turn.errorDetail,
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

  private clearResumeCursor(conversationId: string): void {
    this.deps.conversations.updateMeta(conversationId, { cliResumeCursor: null })
  }

  private disposeRuntime(
    conversationId: string,
    options?: { replacing?: boolean }
  ): void {
    const runtime = this.runtimes.get(conversationId)
    if (!runtime) return
    if (options?.replacing) this.ignoreNextExit.add(conversationId)
    runtime.driver.dispose()
    this.runtimes.delete(conversationId)
  }

  private quotaWindowsFor(conversationId: string): QuotaWindow[] {
    const conversation = this.deps.conversations.get(conversationId)
    const host = conversation?.cliHost
    const account = host && this.deps.quota ? this.deps.quota.get(host) : []
    return mergeQuotaWindowsPreferNewer(account, conversation?.quotaWindows ?? [])
  }

  private async describeTurnError(
    conversationId: string,
    raw: string,
    code?: number | null
  ): Promise<{ kind: CliErrorKind; message: string }> {
    const conversation = this.deps.conversations.get(conversationId)
    const host = conversation?.cliHost
    if (host && this.deps.quota) {
      await this.deps.quota.forceRefresh(host)
    }
    return describeCliHostError(raw, this.quotaWindowsFor(conversationId), code)
  }

  private async settleFailedTurn(
    conversationId: string,
    turn: HostTurn,
    raw: string,
    code?: number | null,
    detail?: string
  ): Promise<void> {
    if (!this.turns.has(conversationId) || this.turns.get(conversationId) !== turn) return
    if (turn.settling) return
    if (turn.cancelled || classifyCliError(raw, null, code) === 'cancelled') {
      turn.cancelled = true
      turn.error = undefined
      turn.errorKind = undefined
      turn.errorDetail = undefined
      void this.finishTurn(conversationId, turn, false)
      return
    }
    turn.settling = true
    turn.errorDetail = detail?.trim() || formatErrorDetailFromParts(raw, code)

    const described = await this.describeTurnError(conversationId, raw, code)
    if (!this.turns.has(conversationId) || this.turns.get(conversationId) !== turn) return
    if (described.kind === 'cancelled') {
      turn.cancelled = true
      turn.error = undefined
      turn.errorKind = undefined
      turn.errorDetail = undefined
      void this.finishTurn(conversationId, turn, false)
      return
    }
    const runtime = this.runtimes.get(conversationId)
    const hadCursor = !!runtime?.cursor || !!this.deps.conversations.get(conversationId)?.cliResumeCursor

    if (!turn.retriedFreshSession && shouldRetryFreshSession(described.kind, raw, hadCursor, code)) {
      turn.retriedFreshSession = true
      turn.settling = false
      turn.error = undefined
      turn.errorKind = undefined
      turn.errorDetail = undefined
      this.clearResumeCursor(conversationId)
      this.disposeRuntime(conversationId, { replacing: true })
      try {
        const next = await this.ensureRuntime(conversationId)
        next.lastTouch = Date.now()
        // New session has no previous-turn dump to strip.
        turn.replay.open()
        next.driver.prompt(turn.prompt)
        return
      } catch (err) {
        const extracted = extractRpcError(err)
        const fallback = await this.describeTurnError(
          conversationId,
          extracted.text || (err instanceof Error ? err.message : String(err)),
          extracted.code
        )
        turn.error = fallback.message
        turn.errorKind = fallback.kind
        turn.errorDetail = formatErrorDetail(err, extracted.text)
        void this.finishTurn(conversationId, turn, false)
        return
      }
    }

    turn.error = described.message
    turn.errorKind = described.kind
    void this.finishTurn(conversationId, turn, false)
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

function isPlanDocRejectText(text: string): boolean {
  const line = text.split('\n')[0]?.trim() ?? ''
  return (
    isApprovalDenyText(text) ||
    line === zhCN['planDoc.reject'] ||
    line === en['planDoc.reject'] ||
    line === zhCN['common.cancel'] ||
    line === en['common.cancel']
  )
}

function isAskCancelText(text: string): boolean {
  const line = text.split('\n')[0]?.trim() ?? ''
  return (
    isApprovalDenyText(text) ||
    line === zhCN['common.cancel'] ||
    line === en['common.cancel'] ||
    line === '已取消'
  )
}

/** Resolve AgentConfig for a host kind from settings. */
export function agentConfigForHost(
  kind: CliHostKind,
  cliAgents: AgentConfig[] | null | undefined
): AgentConfig | null {
  return enabledCliAgents(cliAgents).find((a) => a.id === kind) ?? null
}
