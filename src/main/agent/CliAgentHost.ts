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
  ThinkingLevel,
  ToolCallBlock,
  TurnEvent,
  TurnPhase,
  TurnStatus
} from '@shared/types'
import { parseThinkingLevel } from '@shared/thinkingLevel'
import {
  cursorAuthIdentity,
  isStructuredCliHost,
  transportForCliHost,
  withCursorAuthIdentity
} from '@shared/cliHost'
import { ROOT_LEAF } from '@shared/thread'
import { buildSnapshot, estimateContextTokens, formatExpiry } from '@shared/tokenUsage'
import { attachQuotaNamespace, mergeNamespacedQuotaWindows } from '@shared/quotaWindows'
import {
  classifyCliError,
  extractRpcError,
  formatErrorDetail,
  formatErrorDetailFromParts,
  isBareInternalError,
  NETWORK_CONTINUE_PROMPT,
  NETWORK_RETRY_LIMIT,
  networkRetryDelayMs,
  pickExhaustedQuotaWindow,
  quotaKindMessageKey,
  RpcErrorCode,
  shouldContinuePartialNetworkTurn,
  shouldRetryFreshSession,
  shouldRetrySameSession,
  splitStreamedRetriableError,
  type CliErrorKind
} from '@shared/cliErrors'
import { en, isApprovalApproveText, isApprovalDenyText, zhCN } from '@shared/i18n'
import { normalizeAskQuestions, parseToolInput } from '@shared/askPlan'
import {
  isAskToolName,
  isChecklistToolName,
  isEnterPlanModeName,
  isPlanDocToolName,
  normalizePlanDocInput,
  planDocHasBody,
  planDocSummary,
  planDocToChecklistInput,
  projectChecklistInput,
  sealPlanSteps
} from '@shared/planDoc'
import { enabledCliAgents } from '@shared/types'
import type { AcpSessionState } from '@shared/acpSession'
import {
  acpFormToQuestions,
  parseAcpFormSchema,
  patchAcpConfigOption,
  patchAcpSessionMode
} from '@shared/acpSession'
import { currentLocale, t } from '../i18n'
import { shell } from 'electron'
import type { FileService } from '../fs/FileService'
import type { HostRegistry } from '../host'
function isAcpHost(kind: CliHostKind | null | undefined): boolean {
  return !!kind && transportForCliHost(kind) === 'acp'
}
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
import {
  applyCliHistoryHandoff,
  formatCliWorkspaceHandoff,
  type CliHistoryHandoffMark,
  type CliHistoryHandoffReason
} from './cliHistoryHandoff'
import {
  shouldArmPlanDocFollowUp,
  shouldContinueHeldCliTurn,
  shouldDeferCliTurnFinish
} from './cliTurnHold'
import { createCliHistoryReplayGate, createCliHistoryReplayGateFromBlocks, type CliHistoryReplayGate } from './cliHistoryReplay'
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
  code?: number | null,
  model?: string | null
): { kind: CliErrorKind; message: string } {
  const text = raw.trim() || 'Internal error'
  const locale = currentLocale()
  const kind = classifyCliError(text, windows, code, model)
  if (kind === 'cancelled') return { kind, message: text }
  if (kind === 'quota') {
    const window = pickExhaustedQuotaWindow(windows, model)
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
  if (kind === 'network') return { kind, message: t('error.network') }
  if (isBareInternalError(text)) return { kind: 'generic', message: t('error.agentInternal') }
  return { kind, message: text }
}

/**
 * Did this turn produce anything worth sealing? Reasoning alone does not
 * count — when the answer text was eaten by a leaked stream error, the retry
 * regenerates the thinking along with the reply.
 */
function turnHasAnswerContent(turn: HostTurn): boolean {
  return turn.blocks.some(
    (block) =>
      block.kind === 'toolCall' ||
      block.kind === 'plan' ||
      (block.kind === 'text' && block.text.trim().length > 0)
  )
}

/** A tool still in flight — the turn cannot be treated as a finished reply. */
function turnHasIncompleteWork(turn: HostTurn): boolean {
  return turn.blocks.some(
    (block) =>
      block.kind === 'toolCall' &&
      (block.status === 'pending' || block.status === 'executing')
  )
}

interface PendingPermission {
  requestId: string
  toolCallId: string
  kind: 'permission' | 'plan_doc' | 'ask' | 'form' | 'url'
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
  attachments?: string[]
  sawTurnStarted: boolean
  retriedFreshSession: boolean
  /** Same-session re-prompts already burned on transient network failures. */
  networkRetries: number
  /** A usage event carried real token counts during this turn. */
  sawUsage: boolean
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
  /**
   * Host already returned from the live prompt while a plan / ask is parked.
   * Accept must steer a follow-up on this same turn instead of sealing.
   */
  hostPromptClosed: boolean
  /**
   * Plan accepted while the host prompt was still open (Cursor createPlan
   * contract: the agent then ends the turn without implementing). When the
   * finish arrives with no new agent activity since, steer this text on the
   * same turn instead of sealing it. Any activity from another tool / text
   * disarms it — the agent continued by itself (Claude ExitPlanMode style).
   */
  planFollowUp: { toolCallId: string; text: string } | null
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
  files?: FileService
  /** Lookup for the machine a conversation's agent process should spawn on. */
  hosts?: HostRegistry
  emit: (event: TurnEvent) => void
  /** Sidebar / composer meta after the host heals thinking or fast. */
  publish?: () => void
  /** Sandbox copy → user-visible path (for streaming drafts). */
  logicalPath?: (path: string) => string
  quota?: {
    get(host: CliHostKind): QuotaWindow[]
    identity?(host: CliHostKind): string | null
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
  /**
   * Native session was dropped (workspace switch, lost resume, or retry/edit).
   * The next prompt gets the stored transcript prepended so the new session
   * keeps the conversation — without the turn being replaced, for retry.
   */
  private historyHandoff = new Map<string, CliHistoryHandoffMark>()
  /** Model picked while a turn is live — apply when that turn ends. */
  private pendingModel = new Map<string, string>()
  /**
   * Stop arrived before the turn was registered (phone tap during spawn).
   * {@link startTurn} must not prompt after this.
   */
  private pendingCancels = new Set<string>()

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
      conversation.fileReadOnly === true,
      isAcpHost(conversation.cliHost)
    )
    await this.startTurn(conversationId, userMessage.id, userMessage.parentId, prompt, {
      attachments
    })
  }

  /**
   * Answers the same prompt again.
   *
   * History must stop before the reply being replaced — a second version,
   * not a follow-up. The live CLI session still holds that turn, so it is
   * dropped and the stored transcript is handed to a fresh session.
   */
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
      conversation!.fileReadOnly === true,
      isAcpHost(conversation!.cliHost)
    )
    // Same session still holds the turn we are replacing — prompting again
    // would be a follow-up. Drop it and hand off history that stops before
    // this prompt, so the new attempt does not see the previous answer.
    this.dropNativeSessionForRetry(conversationId)
    await this.startTurn(conversationId, randomUUID(), parentId, prompt, {
      attachments: user.attachments
    })
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
      conversation.fileReadOnly === true,
      isAcpHost(conversation.cliHost)
    )
    this.dropNativeSessionForRetry(conversationId)
    await this.startTurn(conversationId, userMessage.id, userMessage.parentId, prompt, {
      attachments: userMessage.attachments
    })
  }

  cancel(conversationId: string): void {
    this.pendingCancels.add(conversationId)
    const turn = this.turns.get(conversationId)
    const runtime = this.runtimes.get(conversationId)
    if (turn) {
      turn.cancelled = true
      turn.planFollowUp = null
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
      pending.kind === 'ask' || pending.kind === 'form'
        ? !isAskCancelText(text)
        : pending.kind === 'plan_doc'
          ? !isPlanDocRejectText(text)
          : pending.kind === 'url'
            ? !isAskCancelText(text) && !isApprovalDenyText(text)
            : isApprovalApproveText(text, false)
    turn.pendingPermissions.delete(pending.toolCallId)
    const runtime = this.runtimes.get(conversationId)
    if (pending.kind === 'url' && allow) {
      const url = extractUrlFromInput(
        turn.blocks.find((b) => b.kind === 'toolCall' && b.id === pending.toolCallId)
      )
      if (url) void shell.openExternal(url)
    }
    if (pending.synthetic) {
      runtime?.driver.steer?.(text)
    } else {
      runtime?.driver.respond(pending.requestId, allow ? 'allow' : 'deny', text)
    }
    const continueHeld = shouldContinueHeldCliTurn({
      hostPromptClosed: turn.hostPromptClosed,
      remaining: turn.pendingPermissions.size,
      allow,
      alreadySteered: pending.synthetic === true
    })
    const sealHeldReject =
      !allow && turn.hostPromptClosed && turn.pendingPermissions.size === 0
    if (continueHeld || sealHeldReject) turn.hostPromptClosed = false
    if (continueHeld) {
      turn.error = undefined
      turn.errorKind = undefined
      turn.errorCode = undefined
      turn.errorDetail = undefined
      runtime?.driver.steer?.(text)
    }
    if (
      shouldArmPlanDocFollowUp({
        kind: pending.kind,
        allow,
        hostPromptClosed: continueHeld || turn.hostPromptClosed,
        remaining: turn.pendingPermissions.size,
        alreadySteered: pending.synthetic === true
      })
    ) {
      turn.planFollowUp = { toolCallId: pending.toolCallId, text }
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
    if (sealHeldReject) void this.finishTurn(conversationId, turn, true)
    return true
  }

  dispose(conversationId: string): void {
    this.cancel(conversationId)
    this.disposeRuntime(conversationId)
    this.turns.delete(conversationId)
    this.cwdEpoch.delete(conversationId)
    this.historyHandoff.delete(conversationId)
    this.pendingModel.delete(conversationId)
  }

  /** Apply a model change to a live driver; dispose when the transport needs restart. */
  applyModel(conversationId: string, model: string): void {
    this.applyRunPrefs(conversationId, model)
  }

  applyThinkingLevel(conversationId: string): void {
    const model = this.deps.conversations.get(conversationId)?.model
    this.applyRunPrefs(conversationId, model ?? '')
  }

  applyFast(conversationId: string): void {
    const model = this.deps.conversations.get(conversationId)?.model
    this.applyRunPrefs(conversationId, model ?? '')
  }

  private applyRunPrefs(conversationId: string, model: string): void {
    if (this.turns.has(conversationId)) {
      this.pendingModel.set(conversationId, model)
      return
    }
    this.flushModel(conversationId, model)
  }

  private flushModel(conversationId: string, model: string): void {
    const runtime = this.runtimes.get(conversationId)
    if (!runtime) return
    const conversation = this.deps.conversations.get(conversationId)
    const ok = runtime.driver.applyOptions?.({
      model,
      thinkingLevel: conversation?.thinkingLevel ?? null,
      fast: conversation?.fast === true
    })
    if (ok === false) this.dispose(conversationId)
  }

  applySessionMode(conversationId: string, modeId: string): void {
    const runtime = this.runtimes.get(conversationId)
    runtime?.driver.applyOptions?.({ mode: modeId })
    const current = this.deps.conversations.get(conversationId)?.acpSession
    this.persistAcpSession(conversationId, patchAcpSessionMode(current, modeId))
  }

  applySessionConfig(conversationId: string, id: string, value: string | boolean): void {
    const runtime = this.runtimes.get(conversationId)
    runtime?.driver.applyOptions?.({ configOption: { id, value } })
    const current = this.deps.conversations.get(conversationId)?.acpSession
    const next = patchAcpConfigOption(current, id, value)
    if (next) this.persistAcpSession(conversationId, next)
  }

  /**
   * Transcript edited (message delete). Drop the host resume cursor so the
   * next turn follows the remaining VAV tree, not the deleted turns.
   */
  invalidateResume(conversationId: string): void {
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation || !isStructuredCliHost(conversation.cliHost)) return
    this.markHistoryHandoff(conversationId, this.conversationCwd(conversationId))
    this.clearResumeCursor(conversationId)
    if (this.turns.has(conversationId)) this.cancel(conversationId)
    this.disposeRuntime(conversationId, { replacing: true })
  }

  /**
   * Conversation root changed. Live drivers and resume cursors belong to the
   * old workspace — the next turn must spawn a fresh session in `cwd`.
   * The stored transcript is handed off on that first prompt so the
   * conversation continues.
   */
  setWorkingDirectory(
    conversationId: string,
    cwd: string,
    previousCwd?: string | null
  ): void {
    const wanted = cwd || homedir()
    const runtime = this.runtimes.get(conversationId)
    if (!shouldReplaceCliRuntime(runtime?.cwd, wanted, this.starting.has(conversationId))) {
      return
    }

    this.markHistoryHandoff(conversationId, previousCwd ?? runtime?.cwd ?? null)
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
    prompt: string,
    extras?: { attachments?: string[] }
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
      attachments: extras?.attachments,
      sawTurnStarted: false,
      retriedFreshSession: false,
      networkRetries: 0,
      sawUsage: false,
      settling: false,
      pendingPermissions: new Map(),
      reasoningStartedAt: new Map(),
      permissionByRequest: new Map(),
      nestedDirty: new Set(),
      replay: createCliHistoryReplayGate(conversation.messages),
      hostPromptClosed: false,
      planFollowUp: null
    }
    // Fresh native session: the previous assistant is not replayed, and a
    // retry of the same prompt often starts with the same words — do not
    // strip the new answer as if it were a resume dump.
    if (this.historyHandoff.has(conversationId)) {
      turn.replay.open()
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
    if (this.takePendingCancel(conversationId, turn)) {
      void this.finishTurn(conversationId, turn, false)
      return
    }

    try {
      const runtime = await this.ensureRuntime(conversationId)
      if (this.takePendingCancel(conversationId, turn) || this.turns.get(conversationId) !== turn) {
        runtime.driver.cancel()
        if (this.turns.get(conversationId) === turn) {
          void this.finishTurn(conversationId, turn, false)
        }
        return
      }
      runtime.lastTouch = Date.now()
      const handed = this.consumeHistoryHandoff(conversationId, turn.parentId)
      if (handed !== prompt) {
        turn.prompt = handed
      }
      runtime.driver.prompt(handed, extras)
    } catch (err) {
      const extracted = extractRpcError(err)
      // settleFailedTurn owns the retry ladder (network re-prompt, fresh
      // session) so spawn/connect failures recover the same way prompt
      // failures do.
      void this.settleFailedTurn(
        conversationId,
        turn,
        extracted.text || (err instanceof Error ? err.message : String(err)),
        extracted.code,
        formatErrorDetail(err, extracted.text)
      )
    }
  }

  private conversationCwd(conversationId: string): string {
    return this.deps.conversations.get(conversationId)?.workingDirectory || homedir()
  }

  private hostProcessFor(conversationId: string) {
    const machineId = this.deps.conversations.get(conversationId)?.machineId
    return this.deps.hosts?.hostFor(machineId).process
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
          this.markHistoryHandoff(conversationId, existing.cwd)
          this.cwdEpoch.set(
            conversationId,
            (this.cwdEpoch.get(conversationId) ?? 0) + 1
          )
        } else {
          // Login switched — the old session is unreachable; carry the
          // transcript into the replacement session.
          this.markHistoryHandoff(conversationId, existing.cwd, 'session-lost')
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
      this.markHistoryHandoff(conversationId, cwd, 'session-lost')
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
        thinkingLevel: conversation.thinkingLevel ?? null,
        fast: conversation.fast === true,
        cursor,
        env: agent?.envVars,
        extraArgs: agent?.defaultArgs,
        hostProcess: this.hostProcessFor(conversationId),
        files: this.deps.files
          ? {
              readTextFile: (path) => this.deps.files!.readTextFile(path, conversationId),
              writeTextFile: (path, content) =>
                this.deps.files!.writeTextFile(path, content, conversationId)
            }
          : undefined,
        resumeHandoff: () => this.buildSessionLossHandoff(conversationId)
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

    if (event.type === 'session-state') {
      this.persistAcpSession(conversationId, event.state)
      this.clampThinkingToAllowed(conversationId, event.state.thinkingLevels)
    }

    if (event.type === 'model-applied') {
      this.syncAppliedRunPrefs(conversationId, event)
      return
    }

    const turn = this.turns.get(conversationId)
    if (!turn) {
      if (event.type === 'fs-write') {
        const workdir = this.conversationCwd(conversationId)
        this.deps.changeSets?.recordWrite(
          conversationId,
          workdir,
          event.path,
          event.original,
          event.content
        )
        this.deps.emit({
          type: 'fs-changed',
          conversationId,
          parentPath: event.path.replace(/[/\\][^/\\]+$/, '') || workdir,
          filePath: event.path
        })
        return
      }
      if (event.type === 'usage') {
        this.applyUsage(conversationId, event)
        return
      }
      if (event.type === 'quota') {
        this.applyQuota(conversationId, event.windows)
        return
      }
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
        turn.planFollowUp = null
        if (event.parentId) this.appendNestedDelta(conversationId, turn, event.parentId, 'text', event.text)
        else this.appendDelta(conversationId, turn, 'text', event.text)
        break
      case 'reasoning-delta':
        if (turn.replay.reasoning(event.text) === 'skip') break
        turn.planFollowUp = null
        if (event.parentId) {
          this.appendNestedDelta(conversationId, turn, event.parentId, 'reasoning', event.text)
        } else {
          this.appendDelta(conversationId, turn, 'reasoning', event.text)
        }
        break
      case 'tool':
        if (turn.replay.tool(event.id, event.parentId) === 'skip') break
        // Updates for the accepted plan tool itself (Cursor streams
        // "Creating plan file…" after Accept) do not mean the agent
        // continued working — anything else does.
        if (turn.planFollowUp && event.id !== turn.planFollowUp.toolCallId) {
          turn.planFollowUp = null
        }
        this.applyTool(conversationId, turn, event)
        break
      case 'permission':
        if (turn.replay.isHistoricalTool(event.requestId)) break
        turn.planFollowUp = null
        this.applyPermission(conversationId, turn, event)
        break
      case 'elicitation':
        if (turn.replay.isHistoricalTool(event.toolCallId)) break
        turn.planFollowUp = null
        this.applyElicitation(conversationId, turn, event)
        break
      case 'session-state':
        break
      case 'auth-required': {
        const message = turn.error || t('error.agentAuthRequired')
        turn.error = message
        turn.errorCode = turn.errorCode ?? RpcErrorCode.authRequired
        if (!turn.sawTurnStarted) {
          void this.settleFailedTurn(
            conversationId,
            turn,
            message,
            turn.errorCode,
            turn.errorDetail
          )
        }
        break
      }
      case 'fs-write': {
        const workdir = this.conversationCwd(conversationId)
        this.deps.changeSets?.recordWrite(
          conversationId,
          workdir,
          event.path,
          event.original,
          event.content
        )
        this.deps.emit({
          type: 'fs-changed',
          conversationId,
          parentPath: event.path.replace(/[/\\][^/\\]+$/, '') || workdir,
          filePath: event.path
        })
        break
      }
      case 'usage':
        this.applyUsage(conversationId, event)
        break
      case 'quota':
        this.applyQuota(conversationId, event.windows)
        break
      case 'error':
        if (
          turn.cancelled ||
          this.classifyTurnError(conversationId, event.message, event.errorCode) === 'cancelled'
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
        const finishKind = this.classifyTurnError(
          conversationId,
          event.error || turn.error || '',
          event.errorCode ?? turn.errorCode
        )
        // Payment / quota must win over stopReason=cancelled so we keep the
        // resume cursor instead of treating the thread as user-aborted.
        if (finishKind !== 'quota' && (event.cancelled || finishKind === 'cancelled')) {
          turn.cancelled = true
        }
        if (
          shouldDeferCliTurnFinish(turn.pendingPermissions.size, turn.cancelled)
        ) {
          // Plan / ask still waiting — do not seal the thread. Accept plan
          // continues this same turn instead of starting a one-shot follow-up.
          turn.hostPromptClosed = true
          turn.error = undefined
          turn.errorKind = undefined
          turn.errorCode = undefined
          turn.errorDetail = undefined
          break
        }
        // cursor-agent ACP leaks internal stream teardowns ("Error:
        // RetriableError: WritableIterable is closed") as a trailing
        // agent_message_chunk while still reporting stopReason=end_turn.
        // Strip that tail so it never seals into the transcript.
        // Empty reply → same-session retry of the original prompt.
        // Transport disconnect (or an open tool) after partial output →
        // keep the draft and continue; do not seal as Done.
        if (event.success && !turn.cancelled) {
          this.flushBuffers(conversationId, turn)
          const leaked = this.stripLeakedStreamError(turn)
          if (leaked && !turnHasAnswerContent(turn)) {
            this.resetTurnDraft(conversationId, turn)
            void this.settleFailedTurn(conversationId, turn, leaked, null)
            break
          }
          if (
            leaked &&
            shouldContinuePartialNetworkTurn(leaked, turnHasIncompleteWork(turn))
          ) {
            void this.settleFailedTurn(conversationId, turn, leaked, null)
            break
          }
        }
        if (
          event.success &&
          !turn.cancelled &&
          turn.planFollowUp &&
          runtime?.driver.steer
        ) {
          // Cursor ended the planning turn right after Accept without doing
          // any work — keep this same VAV turn alive and prompt it onward.
          const followUp = turn.planFollowUp
          turn.planFollowUp = null
          turn.hostPromptClosed = false
          turn.error = undefined
          turn.errorKind = undefined
          turn.errorCode = undefined
          turn.errorDetail = undefined
          runtime.driver.steer(followUp.text)
          this.setPhase(conversationId, turn, 'working')
          break
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
          // A retry already in backoff owns this turn — drop the dead
          // process so ensureRuntime can respawn, but do not seal.
          if (turn.settling) {
            this.runtimes.delete(conversationId)
            return
          }
          if (!turn.cancelled) {
            const raw = turn.error || `Agent process exited (${event.code ?? '?'})`
            turn.errorDetail =
              turn.errorDetail || formatErrorDetailFromParts(raw, event.code)
            void this.settleFailedTurn(
              conversationId,
              turn,
              raw,
              turn.errorCode,
              turn.errorDetail
            )
          } else {
            void this.finishTurn(conversationId, turn, false)
          }
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

  /**
   * cursor-agent ACP streams internal stream teardowns ("Error:
   * RetriableError: WritableIterable is closed") as a trailing
   * agent_message_chunk and still reports end_turn. The leak always lands at
   * the end of the trailing text block — remove it and return the leaked
   * error text so the caller can decide whether the turn survived.
   */
  private stripLeakedStreamError(turn: HostTurn): string | null {
    const last = turn.blocks[turn.blocks.length - 1]
    if (!last || last.kind !== 'text') return null
    const split = splitStreamedRetriableError(last.text)
    if (!split.leaked) return null
    if (split.text) {
      last.text = split.text
    } else {
      turn.blocks.pop()
      if (turn.textIndex != null && turn.textIndex >= turn.blocks.length) {
        turn.textIndex = null
      }
    }
    return split.leaked
  }

  /**
   * The whole streamed reply was a leaked internal error and the turn is
   * being retried: drop the polluted blocks and restart the live projection
   * so the retry streams onto a clean draft.
   */
  private resetTurnDraft(conversationId: string, turn: HostTurn): void {
    if (turn.flushTimer) {
      clearTimeout(turn.flushTimer)
      turn.flushTimer = null
    }
    turn.blocks = []
    turn.buffers.clear()
    turn.textIndex = null
    turn.reasoningIndex = null
    turn.toolIndex.clear()
    turn.toolCount = 0
    turn.reasoningStartedAt.clear()
    turn.nestedDirty.clear()
    this.deps.emit({ type: 'start', conversationId })
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
    if (this.applyChecklistTool(conversationId, turn, event)) return
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

  /**
   * Fold every host checklist (TodoWrite / update_plan / ACP plan) onto one
   * live `plan` block so the overlay can tick steps instead of freezing at 0.
   */
  private applyChecklistTool(
    conversationId: string,
    turn: HostTurn,
    event: Extract<DriverEvent, { type: 'tool' }>
  ): boolean {
    if (isEnterPlanModeName(event.name)) return false
    if (!isChecklistToolName(event.name) && mapToolName(event.name) !== 'plan') return false
    if (mapToolName(event.name) !== 'plan') return false

    const incoming = projectChecklistInput(event.input)
    let index = turn.toolIndex.get(event.id)
    if (index == null) {
      const existing = findChecklistIndex(turn.blocks)
      if (existing != null) {
        index = existing
        turn.toolIndex.set(event.id, index)
      }
    }
    if (index == null) {
      if (incoming.steps.length === 0 && event.status !== 'started' && event.status !== 'updated') {
        return false
      }
      index = turn.blocks.length
      turn.toolIndex.set(event.id, index)
      const title = event.title || incoming.title || event.name
      const block: ToolCallBlock = {
        kind: 'toolCall',
        id: event.id,
        tool: 'plan',
        summary: title,
        input: inputJson(incoming),
        output: '',
        status: 'pending'
      }
      turn.blocks.push(block)
      this.sealOpenReasoning(turn)
      turn.textIndex = null
      turn.reasoningIndex = null
    }

    const block = turn.blocks[index] as ToolCallBlock
    const previousInput = block.input
    this.patchToolBlock(block, event)
    block.tool = 'plan'
    if (incoming.steps.length) {
      const current = projectChecklistInput(parseToolInput(previousInput))
      const title =
        incoming.title && incoming.title !== 'Plan' ? incoming.title : current.title || incoming.title
      block.input = inputJson({ title, steps: incoming.steps })
      const done = incoming.steps.filter((step) => step.status === 'done').length
      block.summary = `Plan · ${title} (${done}/${incoming.steps.length})`
    } else {
      block.input = previousInput
    }

    if (event.status === 'completed' || event.status === 'error') {
      turn.toolCount++
      turn.pendingPermissions.delete(block.id)
    }
    const next = snapshotToolBlock(block)
    turn.blocks[index] = next
    this.deps.emit({ type: 'tool', conversationId, index, block: next })
    this.setPhase(conversationId, turn, 'working')
    return true
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
        synthetic: false,
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
        synthetic: false,
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
    const tool: ToolCallBlock['tool'] =
      event.kind === 'plan_doc' ? 'plan_doc' : event.kind === 'url' ? 'request' : 'ask_user_question'
    const parsed = event.input && typeof event.input === 'object' ? (event.input as Record<string, unknown>) : {}
    const formFields = event.kind === 'form' ? parseAcpFormSchema(parsed.requestedSchema ?? parsed.schema) : []
    const questions =
      event.kind === 'ask'
        ? normalizeAskQuestions(parsed)
        : event.kind === 'form'
          ? acpFormToQuestions(formFields.length ? formFields : parseAcpFormSchema(parsed))
          : undefined
    const summary =
      event.kind === 'plan_doc'
        ? planDocSummary(normalizePlanDocInput(event.input))
        : event.kind === 'url'
          ? event.title || (typeof parsed.url === 'string' ? parsed.url : t('tool.ask'))
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
        askTitle: event.title,
        choices: event.kind === 'url' ? [t('common.open'), t('common.cancel')] : undefined
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
    const tagged = this.namespaceQuota(conversationId, windows)
    if (!tagged.length) return
    const changed = this.deps.conversations.mergeQuotaWindows(conversationId, tagged)
    if (!changed) return
    this.emitUsageSnapshot(conversationId)
  }

  private emitUsageSnapshot(conversationId: string, extras?: { newSnapshot?: boolean }): void {
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
      quotaWindows: updated.quotaWindows ?? [],
      newSnapshot: extras?.newSnapshot === true
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
      const tagged = this.namespaceQuota(conversationId, event.quotaWindows)
      if (tagged.length) {
        quotaChanged = this.deps.conversations.mergeQuotaWindows(conversationId, tagged)
      }
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
      const last = live.tokenHistory?.at(-1)
      const duplicate =
        last != null &&
        last.newInputTokens === input &&
        last.outputTokens === output &&
        last.cacheReadTokens === cacheRead &&
        last.cacheWriteTokens === cacheWrite
      if (!duplicate) {
        const snapshot = buildSnapshot({
          turnIndex: (live.tokenHistory?.length ?? 0) + 1,
          usage: { input, output, cacheRead, cacheWrite },
          modelId: live.model || 'cli',
          costUsd: event.turnCostUsd,
          accountId: live.accountId ?? null
        })
        this.deps.conversations.recordTokenSnapshot(conversationId, snapshot)
        snapshotTotal = snapshot.totalInputTokens
      } else {
        snapshotTotal = last.totalInputTokens
      }
    }

    const fill =
      typeof event.contextUsed === 'number' && event.contextUsed >= 0
        ? event.contextUsed
        : snapshotTotal
    if (typeof fill === 'number' && fill >= 0) {
      this.deps.conversations.setContextFill(conversationId, fill)
    }

    // Real token data arrived — the end-of-turn estimate must stand down.
    if (fill != null || (recordHistory && hasTurnTokens)) {
      const turn = this.turns.get(conversationId)
      if (turn) turn.sawUsage = true
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
    this.emitUsageSnapshot(conversationId, {
      newSnapshot: Boolean(recordHistory && hasTurnTokens)
    })
  }

  private takePendingCancel(conversationId: string, turn: HostTurn): boolean {
    if (!this.pendingCancels.delete(conversationId) && !turn.cancelled) return false
    turn.cancelled = true
    return true
  }

  private async finishTurn(
    conversationId: string,
    turn: HostTurn,
    _success: boolean
  ): Promise<void> {
    if (!this.turns.has(conversationId)) return
    this.pendingCancels.delete(conversationId)
    // Prevent double-finish from cancel grace + turn-finished race.
    this.turns.delete(conversationId)
    const pendingModel = this.pendingModel.get(conversationId)
    if (pendingModel) {
      this.pendingModel.delete(conversationId)
      this.flushModel(conversationId, pendingModel)
    }
    this.flushBuffers(conversationId, turn)
    this.sealOpenReasoning(turn)

    expireOpenTools(turn.blocks, turn.cancelled)
    sealCliPlanBlocks(turn.blocks, turn.cancelled ? 'cancel' : turn.error ? 'error' : 'success')

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
    this.applyEstimatedContextFill(conversationId, turn)
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

  /**
   * Hosts like `cursor-agent acp` never report usage over the protocol and
   * keep their session store encrypted on disk. When a turn ends without any
   * token data — this turn saw none and the conversation never accumulated
   * any — estimate the context fill from the transcript so the ring shows a
   * truthful shape instead of nothing. Real usage (this host or another)
   * always wins: any recorded history disables the estimate.
   */
  private applyEstimatedContextFill(conversationId: string, turn: HostTurn): void {
    if (turn.sawUsage || turn.cancelled) return
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation) return
    if ((conversation.tokenHistory?.length ?? 0) > 0) return
    const estimate = estimateContextTokens(conversation.messages)
    if (estimate <= 0 || estimate === conversation.tokensUsed) return
    this.deps.conversations.setContextFill(conversationId, estimate)
    this.emitUsageSnapshot(conversationId)
  }

  /**
   * Retry / edit must not keep talking to the native session that already
   * contains the turn being replaced. Drop the process and resume cursor;
   * the next prompt gets a transcript preamble that stops before that turn.
   */
  private dropNativeSessionForRetry(conversationId: string): void {
    this.markHistoryHandoff(conversationId, this.conversationCwd(conversationId), 'retry')
    this.clearResumeCursor(conversationId)
    this.disposeRuntime(conversationId, { replacing: true })
  }

  private markHistoryHandoff(
    conversationId: string,
    previousCwd: string | null,
    reason: CliHistoryHandoffReason = 'cwd-changed'
  ): void {
    const conversation = this.deps.conversations.get(conversationId)
    if ((conversation?.messages.length ?? 0) === 0) return
    this.historyHandoff.set(conversationId, { previousCwd, reason })
  }

  private consumeHistoryHandoff(conversationId: string, leafId: string | null): string {
    const turn = this.turns.get(conversationId)
    const prompt = turn?.prompt ?? ''
    const mark = this.historyHandoff.get(conversationId)
    if (!mark) return prompt
    this.historyHandoff.delete(conversationId)
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation) return prompt
    const handoff = formatCliWorkspaceHandoff({
      messages: conversation.messages,
      leafId,
      excludeMessageId: turn?.parentId ?? null,
      compactions: conversation.compactions,
      previousCwd: mark.previousCwd,
      nextCwd: this.conversationCwd(conversationId),
      reason: mark.reason
    })
    return applyCliHistoryHandoff(prompt, handoff)
  }

  /**
   * The driver resumed by sessionId but the host replaced it with a brand-new
   * session (stale / lost native session). Build the transcript preamble the
   * driver prepends to the replacement session's first prompt.
   */
  private buildSessionLossHandoff(conversationId: string): string | null {
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation || conversation.messages.length === 0) return null
    const turn = this.turns.get(conversationId) ?? null
    const activeLeaf = this.deps.conversations.activeLeaf(conversationId)
    const leafId = turn ? turn.parentId : activeLeaf === ROOT_LEAF ? null : activeLeaf
    const cwd = this.conversationCwd(conversationId)
    return formatCliWorkspaceHandoff({
      messages: conversation.messages,
      leafId,
      excludeMessageId: turn?.parentId ?? null,
      compactions: conversation.compactions,
      previousCwd: cwd,
      nextCwd: cwd,
      reason: 'session-lost'
    })
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

  private namespaceQuota(conversationId: string, windows: QuotaWindow[]): QuotaWindow[] {
    const host = this.deps.conversations.get(conversationId)?.cliHost
    if (!host || !windows.length) return []
    const identity = this.deps.quota?.identity?.(host)
    if (!identity) return []
    return attachQuotaNamespace(windows, host, identity)
  }

  private quotaWindowsFor(conversationId: string): QuotaWindow[] {
    const conversation = this.deps.conversations.get(conversationId)
    const host = conversation?.cliHost
    if (!host) return []
    const identity = this.deps.quota?.identity?.(host) ?? null
    const account = this.deps.quota ? this.deps.quota.get(host) : []
    return mergeNamespacedQuotaWindows(host, identity, account, conversation?.quotaWindows ?? [])
  }

  private conversationModel(conversationId: string): string | null {
    return this.deps.conversations.get(conversationId)?.model ?? null
  }

  private classifyTurnError(
    conversationId: string,
    text: string,
    code?: number | null
  ): CliErrorKind {
    return classifyCliError(
      text,
      this.quotaWindowsFor(conversationId),
      code,
      this.conversationModel(conversationId)
    )
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
    return describeCliHostError(
      raw,
      this.quotaWindowsFor(conversationId),
      code,
      conversation?.model
    )
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

    // Transient network failure: keep the SAME session after a short
    // backoff. The resume cursor is kept — the thread must not lose context —
    // and the turn stays live so the UI never paints a break. Classified
    // cheaply (no quota refresh) so the retry starts right away.
    const quickKind = this.classifyTurnError(conversationId, raw, code)
    if (shouldRetrySameSession(quickKind) && turn.networkRetries < NETWORK_RETRY_LIMIT) {
      turn.networkRetries += 1
      turn.error = undefined
      turn.errorKind = undefined
      turn.errorCode = undefined
      turn.errorDetail = undefined
      const keepPartial = turnHasAnswerContent(turn)
      if (keepPartial) {
        this.flushBuffers(conversationId, turn)
        this.sealOpenReasoning(turn)
        turn.textIndex = null
        turn.replay = createCliHistoryReplayGateFromBlocks(turn.blocks)
        this.setPhase(conversationId, turn, 'retrying')
      } else {
        this.setPhase(conversationId, turn, 'thinking')
      }
      // Keep `settling` held through the backoff so a racing error event
      // cannot start a second retry for the same failure.
      await new Promise((resolve) =>
        setTimeout(resolve, networkRetryDelayMs(turn.networkRetries))
      )
      // Cancelled / superseded while backing off — nothing to resume.
      if (!this.turns.has(conversationId) || this.turns.get(conversationId) !== turn) return
      turn.settling = false
      if (turn.cancelled) {
        void this.finishTurn(conversationId, turn, false)
        return
      }
      try {
        // Reuse the live process when it survived; respawn + resume otherwise.
        const next = await this.ensureRuntime(conversationId)
        next.lastTouch = Date.now()
        if (keepPartial) {
          // Partial output already landed — do not re-prompt the original
          // user message (that would duplicate). Continue on this same VAV
          // turn so the UI stays on the live draft.
          next.driver.prompt(NETWORK_CONTINUE_PROMPT)
        } else {
          turn.replay.open()
          // A respawn during the retry may have replaced the native session
          // (auth switch) — carry the transcript if one was marked.
          turn.prompt = this.consumeHistoryHandoff(conversationId, turn.parentId)
          next.driver.prompt(turn.prompt, { attachments: turn.attachments })
        }
        return
      } catch (err) {
        const extracted = extractRpcError(err)
        void this.settleFailedTurn(
          conversationId,
          turn,
          extracted.text || (err instanceof Error ? err.message : String(err)),
          extracted.code,
          formatErrorDetail(err, extracted.text)
        )
        return
      }
    }

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
    const hadCursor =
      !!runtime?.cursor || !!this.deps.conversations.get(conversationId)?.cliResumeCursor

    if (!turn.retriedFreshSession && shouldRetryFreshSession(described.kind, raw, hadCursor, code)) {
      turn.retriedFreshSession = true
      turn.settling = false
      turn.error = undefined
      turn.errorKind = undefined
      turn.errorDetail = undefined
      // The fresh session knows nothing — prepend the VAV transcript so the
      // conversation survives the swap instead of restarting from one prompt.
      this.markHistoryHandoff(conversationId, this.conversationCwd(conversationId), 'session-lost')
      this.clearResumeCursor(conversationId)
      this.disposeRuntime(conversationId, { replacing: true })
      try {
        const next = await this.ensureRuntime(conversationId)
        next.lastTouch = Date.now()
        // New session has no previous-turn dump to strip.
        turn.replay.open()
        turn.prompt = this.consumeHistoryHandoff(conversationId, turn.parentId)
        next.driver.prompt(turn.prompt, { attachments: turn.attachments })
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

  private persistAcpSession(conversationId: string, state: AcpSessionState): void {
    this.deps.conversations.updateMeta(conversationId, { acpSession: state })
    this.deps.emit({ type: 'cli-session', conversationId, state })
  }

  private clampThinkingToAllowed(
    conversationId: string,
    allowed: ThinkingLevel[] | undefined
  ): void {
    if (!allowed?.length) return
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation) return
    const current = parseThinkingLevel(conversation.thinkingLevel)
    if (allowed.includes(current)) return
    const next = allowed.includes('max') ? 'max' : allowed[allowed.length - 1]!
    this.deps.conversations.setThinkingLevel(conversationId, next)
    this.applyThinkingLevel(conversationId)
    this.deps.publish?.()
  }

  /**
   * Cursor ACP may reject an overlaid thinking / fast id and land on the
   * family's advertised default. Heal the chips to what actually applied.
   */
  private syncAppliedRunPrefs(
    conversationId: string,
    event: Extract<DriverEvent, { type: 'model-applied' }>
  ): void {
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation) return
    let changed = false
    if (event.thinkingLevel && event.thinkingLevel !== conversation.thinkingLevel) {
      this.deps.conversations.setThinkingLevel(conversationId, event.thinkingLevel)
      changed = true
    }
    if (typeof event.fast === 'boolean' && event.fast !== (conversation.fast === true)) {
      this.deps.conversations.setFast(conversationId, event.fast)
      changed = true
    }
    if (changed) this.deps.publish?.()
  }

  private composePrompt(
    text: string,
    quote?: QuoteDraft | null,
    contextBlocks?: PreviewRef[] | null,
    attachments?: string[],
    contextFile?: string | null,
    fileReadOnly = false,
    omitAttachmentPaths = false
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
    if (attachments?.length && !omitAttachmentPaths) {
      parts.push(`[Attachments]\n${attachments.map((a) => `- ${a}`).join('\n')}`)
    }
    if (quote?.summary) {
      parts.push(`[Quoted ${quote.role} message]\n${quote.summary}`)
    }
    parts.push(text)
    return parts.join('\n\n')
  }
}

function findChecklistIndex(blocks: MessageBlock[]): number | null {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block?.kind === 'toolCall' && block.tool === 'plan') return i
  }
  return null
}

function sealCliPlanBlocks(
  blocks: MessageBlock[],
  mode: 'cancel' | 'error' | 'success'
): void {
  for (const block of blocks) {
    if (block.kind !== 'toolCall' || block.tool !== 'plan') continue
    const input = projectChecklistInput(parseToolInput(block.input))
    if (input.steps.length === 0) continue
    const steps = sealPlanSteps(input.steps, mode, {
      cancelled: t('common.cancelled'),
      failed: t('common.failed')
    })
    const done = steps.filter((step) => step.status === 'done').length
    block.input = inputJson({ title: input.title, steps })
    block.summary = `Plan · ${input.title} (${done}/${steps.length})`
    if (block.status === 'pending' || block.status === 'executing') {
      block.status = 'completed'
    }
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

function extractUrlFromInput(block: MessageBlock | undefined): string | null {
  if (!block || block.kind !== 'toolCall') return null
  const parsed = parseToolInput(block.input)
  return typeof parsed.url === 'string' && parsed.url.trim() ? parsed.url.trim() : null
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
