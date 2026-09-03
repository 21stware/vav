import type { ApprovalMode, CliHostKind, PlanStep } from '../../../shared/types.ts'
import {
  extractRpcError,
  formatErrorDetail,
  rpcErrorCode,
  RpcErrorCode
} from '../../../shared/cliErrors.ts'
import {
  ACP_CLIENT_CAPABILITIES,
  ACP_PROTOCOL_VERSION,
  acpFormContentFromAnswers,
  applyGoalSlash,
  goalUsesRpc,
  mergeAcpSessionState,
  optimisticGoal,
  parseAcpAuthMethods,
  parseAcpAvailableCommands,
  parseAcpConfigOptions,
  parseAcpFormSchema,
  parseAcpGoalCapability,
  parseAcpPromptCapabilities,
  parseAcpSessionModes,
  readGoalSnapshotFromUpdate,
  resolveGoalCapability,
  seedGoalCommands,
  type AcpAuthMethod,
  type AcpContentBlock,
  type AcpFormField,
  type AcpPromptCapabilities,
  type AcpSessionState,
  type GoalCapability
} from '../../../shared/acpSession.ts'
import {
  acpPlanEntriesToSteps,
  cursorAskOutcomeFromAnswer,
  cursorAskToToolInput,
  isPlanDocToolName,
  mergeTodos,
  normalizeCursorAskInput,
  normalizePlanDocInput,
  planDocHasBody,
  planDocOutcomeFromAnswer,
  planDocToChecklistInput,
  todosToSteps,
  type CursorAskInput
} from '../../../shared/planDoc.ts'
import {
  cursorFamilyAllowsThinkingOverlay,
  cursorModelFamilyId,
  prefsFromCursorModelId
} from '../../../shared/cursorModel.ts'
import { clampThinkingLevel } from '../../../shared/thinkingLevel.ts'
import {
  acpBootstrapModelId,
  acpModelIdCandidates,
  advertisedThinkingLevel,
  parseAcpAvailableModels,
  type AcpListedModel
} from './acpModelId.ts'
import {
  contextSizeFromModelId,
  isSessionLevelAcpUpdate,
  normalizeUpdateKind,
  readAcpUsageFromPromptResult,
  readAcpUsageFromUpdate,
  type AcpUsageSample
} from './acpUsage.ts'
import { acpReadTextFile, acpWriteTextFile, AcpRpcError } from './acpFs.ts'
import { buildAcpPrompt } from './acpPrompt.ts'
import { AcpTerminalRegistry } from './acpTerminal.ts'
import { disposeStdioProcess } from './disposeStdio.ts'
import {
  asArray,
  asRecord,
  asString,
  dig,
  onJsonLines,
  type StdioProcess
} from './stdioJson.ts'
import type {
  DriverControl,
  DriverEventSink,
  DriverPromptExtras,
  DriverStartOptions
} from './types.ts'

const ACP_PLAN_ID = 'acp-session-plan'
const CURSOR_TODOS_ID = 'cursor-todos'

type PendingClient =
  | { kind: 'permission'; id: unknown; options: unknown[] }
  | { kind: 'create_plan'; id: unknown; toolCallId: string }
  | { kind: 'ask_question'; id: unknown; toolCallId: string; ask: CursorAskInput }
  | { kind: 'form'; id: unknown; toolCallId: string; fields: AcpFormField[] }
  | { kind: 'url'; id: unknown; toolCallId: string; elicitationId?: string }

type QueuedPrompt = { text: string; extras?: DriverPromptExtras }

/** ACP-speaking hosts in the VAV catalogue. */
export type AcpHostKind = Extract<CliHostKind, 'cursor' | 'grok' | 'devin' | 'kiro' | 'cline'>

function acpArgs(kind: AcpHostKind, approvalMode: ApprovalMode): string[] {
  switch (kind) {
    case 'cursor':
      return ['acp']
    case 'grok':
      return ['agent', 'stdio']
    case 'devin':
      return ['acp']
    case 'kiro':
      return approvalMode === 'bypass' || approvalMode === 'auto'
        ? ['acp', '--trust-all-tools']
        : ['acp']
    case 'cline':
      return approvalMode === 'bypass' || approvalMode === 'auto'
        ? ['--acp', '--auto-approve', 'true']
        : ['--acp']
  }
}

/** Cursor `--model` + ACP subcommand. Extra argv from AgentConfig stay last. */
export function acpInvokeArgs(
  kind: AcpHostKind,
  approvalMode: ApprovalMode,
  options?: Pick<DriverStartOptions, 'model' | 'thinkingLevel' | 'fast' | 'extraArgs'>
): string[] {
  const extra = options?.extraArgs ?? []
  const boot =
    kind === 'cursor'
      ? acpBootstrapModelId(options?.model, {
          thinkingLevel: options?.thinkingLevel ?? null,
          fast: typeof options?.fast === 'boolean' ? options.fast : null
        })
      : null
  const modelArg = boot && !extra.includes('--model') ? ['--model', boot] : []
  return [...modelArg, ...acpArgs(kind, approvalMode), ...extra]
}

/**
 * Full ACP v1 client over stdio.
 *
 * - Cursor: `cursor-agent acp`
 * - Grok:   `grok agent stdio`
 * - Devin:  `devin acp`
 * - Kiro:   `kiro-cli acp`
 * - Cline:  `cline --acp`
 */
export async function startAcpDriver(
  kind: AcpHostKind,
  options: DriverStartOptions,
  emit: DriverEventSink
): Promise<DriverControl> {
  const { spawnStdioProcess } = await import('./process.ts')
  const args = acpInvokeArgs(kind, options.approvalMode, options)
  const proc = spawnStdioProcess(
    options.binary,
    args,
    options.cwd,
    options.env,
    options.hostProcess
  )
  return wireAcp(kind, proc, options, emit)
}

export function wireAcp(
  kind: AcpHostKind,
  proc: StdioProcess,
  options: DriverStartOptions,
  emit: DriverEventSink
): DriverControl {
  let disposed = false
  let nextId = 1
  let sessionId: string | null =
    options.cursor?.provider === kind && 'sessionId' in options.cursor
      ? options.cursor.sessionId
      : null
  let turnActive = false
  let promptInFlightId: number | null = null
  let ready = false
  let canLogout = false
  /**
   * A resume-by-id fell back to session/new — the next prompt must carry the
   * transcript preamble (options.resumeHandoff) or the conversation is lost.
   */
  let resumeFellBack = false
  let promptCapabilities: AcpPromptCapabilities = {
    image: false,
    audio: false,
    embeddedContext: false
  }
  let sessionState: AcpSessionState = {}
  let advertisedGoal: GoalCapability | null = null
  const pendingPrompts: QueuedPrompt[] = []
  const pendingRpc = new Map<number, (result: unknown, error?: unknown) => void>()
  const pendingClient = new Map<string, PendingClient>()
  const stderrChunks: string[] = []
  const autoApprove = options.approvalMode === 'bypass' || options.approvalMode === 'auto'
  const terminals = new AcpTerminalRegistry(options.hostProcess)
  let lastTodos: PlanStep[] = []
  let availableModels: AcpListedModel[] = []
  let wantedModel = options.model?.trim() || null
  let wantedThinking = options.thinkingLevel ?? null
  let wantedFast: boolean | null = typeof options.fast === 'boolean' ? options.fast : null
  let applyModelChain: Promise<void> = Promise.resolve()
  const rejectedModels = new Set<string>()

  const send = (method: string, params: Record<string, unknown>, id?: number): void => {
    const payload: Record<string, unknown> = { jsonrpc: '2.0', method, params }
    if (id !== undefined) payload.id = id
    proc.writeLine(payload)
  }

  const request = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const id = nextId++
    return new Promise((resolve, reject) => {
      pendingRpc.set(id, (result, error) => {
        if (error) reject(error)
        else resolve(result)
      })
      send(method, params, id)
    })
  }

  const respond = (id: unknown, result: unknown): void => {
    proc.writeLine({ jsonrpc: '2.0', id, result })
  }

  const respondError = (id: unknown, error: { code: number; message: string; data?: unknown }): void => {
    proc.writeLine({ jsonrpc: '2.0', id, error })
  }

  const publishSessionState = (patch: Partial<AcpSessionState>): void => {
    sessionState = mergeAcpSessionState(sessionState, patch)
    emit({ type: 'session-state', state: sessionState })
  }

  proc.child.stderr.on('data', (buf: Buffer) => {
    stderrChunks.push(buf.toString('utf8'))
    if (stderrChunks.length > 40) stderrChunks.shift()
  })

  const tryAuthenticate = async (methods: AcpAuthMethod[]): Promise<boolean> => {
    const agentMethod = methods.find((method) => !method.type || method.type === 'agent')
    if (!agentMethod) {
      emit({
        type: 'error',
        message: 'Authentication required',
        errorCode: RpcErrorCode.authRequired
      })
      emit({ type: 'auth-required', methods })
      return false
    }
    try {
      await request('authenticate', { methodId: agentMethod.id })
      return true
    } catch (err) {
      const extracted = extractRpcError(err)
      emit({
        type: 'error',
        message: extracted.text || 'Authentication failed',
        errorCode: extracted.code ?? RpcErrorCode.authRequired,
        errorDetail: formatErrorDetail(err, extracted.text)
      })
      emit({ type: 'auth-required', methods })
      return false
    }
  }

  const openOrCreateSession = async (): Promise<void> => {
    if (sessionId) {
      try {
        const loaded = asRecord(
          await request('session/load', {
            sessionId,
            cwd: options.cwd,
            mcpServers: []
          })
        )
        ingestSessionSetup(loaded, { resume: true })
        return
      } catch {
        try {
          const resumed = asRecord(await request('session/resume', { sessionId, cwd: options.cwd }))
          ingestSessionSetup(resumed, { resume: true })
          return
        } catch {
          sessionId = null
          resumeFellBack = true
        }
      }
    }
    const created = asRecord(await createSession())
    sessionId =
      asString(created?.sessionId) ||
      asString(created?.session_id) ||
      asString(dig(created, 'session.id'))
    ingestSessionSetup(created, { resume: false })
  }

  const wantedPrefs = (): { thinkingLevel: typeof wantedThinking; fast: typeof wantedFast } => ({
    thinkingLevel: wantedThinking,
    fast: wantedFast
  })

  const bootModelId = (): string | null => acpBootstrapModelId(wantedModel, wantedPrefs())

  const createSession = async (): Promise<unknown> => {
    const params: Record<string, unknown> = {
      cwd: options.cwd,
      mcpServers: []
    }
    const modelId = bootModelId()
    if (modelId) params.modelId = modelId
    try {
      return await request('session/new', params)
    } catch (err) {
      // Official ACP session/new has no modelId. Retry plain if Cursor rejects it.
      if (modelId && rpcErrorCode(err) === RpcErrorCode.invalidParams) {
        return await request('session/new', { cwd: options.cwd, mcpServers: [] })
      }
      throw err
    }
  }

  const ingestSessionSetup = (
    created: Record<string, unknown> | null,
    opts: { resume: boolean }
  ): void => {
    if (!created) return
    const modes = parseAcpSessionModes(created.modes)
    const configOptions = parseAcpConfigOptions(created.configOptions ?? created.config_options)
    const commands = seedGoalCommands(
      kind,
      parseAcpAvailableCommands(created.availableCommands ?? created.available_commands)
    )
    const snapshot = readGoalSnapshotFromUpdate(created)
    publishSessionState({
      currentModeId: modes.currentModeId,
      modes: modes.modes,
      configOptions,
      commands,
      sessionTitle: asString(created.title),
      goalCapability: resolveGoalCapability(kind, advertisedGoal, commands),
      ...(opts.resume
        ? snapshot !== undefined
          ? { goal: snapshot }
          : {}
        : { goal: snapshot ?? null })
    })
    const modelsField = created.models
    const listed = parseAcpAvailableModels(modelsField)
    if (listed.length) {
      availableModels = listed
      rejectedModels.clear()
    }
    publishAdvertisedThinkingLevels()
    publishModelContextSize(
      asString(dig(created, 'models.currentModelId')) ||
        asString(dig(created, 'models.current_model_id'))
    )
  }

  const publishAdvertisedThinkingLevels = (): void => {
    if (!wantedModel) return
    const family = cursorModelFamilyId(wantedModel)
    if (!family || cursorFamilyAllowsThinkingOverlay(family)) return
    const level = advertisedThinkingLevel(wantedModel, availableModels)
    if (level) publishSessionState({ thinkingLevels: [level] })
  }

  const applyWantedModel = async (): Promise<void> => {
    if (disposed || !sessionId || !wantedModel) return
    rejectedModels.clear()
    const allowed = sessionState.thinkingLevels
    const thinking =
      wantedThinking && allowed?.length
        ? clampThinkingLevel(wantedThinking, allowed)
        : wantedThinking
    const prefs = {
      thinkingLevel: thinking,
      fast: wantedFast
    }
    const candidates = acpModelIdCandidates(wantedModel, availableModels, prefs)
    for (const modelId of candidates) {
      if (rejectedModels.has(modelId)) continue
      try {
        await request('session/set_model', { sessionId, modelId })
        if (disposed) return
        publishModelContextSize(modelId)
        const applied = prefsFromCursorModelId(modelId)
        emit({ type: 'model-applied', modelId, ...applied })
        return
      } catch {
        if (disposed) return
        rejectedModels.add(modelId)
      }
    }
  }

  const queueApplyWantedModel = (): Promise<void> => {
    applyModelChain = applyModelChain.then(applyWantedModel, applyWantedModel)
    return applyModelChain
  }

  /**
   * Cursor never sends usage over ACP; its model id embeds `context=300k`.
   * Surface that as the conversation's token limit so the ring has a
   * denominator even before any fill estimate lands.
   */
  const publishModelContextSize = (modelId: string | null | undefined): void => {
    const size = contextSizeFromModelId(modelId)
    if (!size) return
    emit({ type: 'usage', contextSize: size, recordHistory: false })
  }

  const bootstrap = async (): Promise<void> => {
    try {
      const init = asRecord(
        await request('initialize', {
          protocolVersion: ACP_PROTOCOL_VERSION,
          clientCapabilities: ACP_CLIENT_CAPABILITIES,
          clientInfo: { name: 'vav', version: '1.0.0' }
        })
      )
      const caps = asRecord(init?.agentCapabilities) ?? asRecord(init?.capabilities)
      promptCapabilities = parseAcpPromptCapabilities(
        caps?.promptCapabilities ?? caps?.prompt_capabilities
      )
      canLogout = asRecord(caps?.auth)?.logout != null || caps?.logout === true
      const authMethods = parseAcpAuthMethods(init?.authMethods ?? init?.auth_methods)
      advertisedGoal = parseAcpGoalCapability(dig(init, '_meta.goal'))

      try {
        await openOrCreateSession()
      } catch (err) {
        const extracted = extractRpcError(err)
        if (extracted.code === RpcErrorCode.authRequired && authMethods.length) {
          if (await tryAuthenticate(authMethods)) {
            sessionId = null
            await openOrCreateSession()
          } else {
            return
          }
        } else {
          throw err
        }
      }

      if (!sessionId) {
        emit({ type: 'error', message: `${kind} ACP session/new returned no sessionId` })
        return
      }

      await queueApplyWantedModel()

      ready = true
      emit({ type: 'connected', cursor: { provider: kind, sessionId } })
      for (const queued of pendingPrompts.splice(0)) void doPrompt(queued.text, queued.extras)
    } catch (err) {
      const extracted = extractRpcError(err)
      emit({
        type: 'error',
        message: extracted.text || (err instanceof Error ? err.message : String(err)),
        errorCode: extracted.code ?? undefined,
        errorDetail: formatErrorDetail(err, extracted.text)
      })
    }
  }

  const handleInbound = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) handleInbound(item)
      return
    }
    const msg = asRecord(value)
    if (!msg) return

    if (msg.id !== undefined && msg.method === undefined) {
      const id = typeof msg.id === 'number' ? msg.id : Number(msg.id)
      const waiter = pendingRpc.get(id)
      if (waiter) {
        pendingRpc.delete(id)
        if (msg.error) waiter(undefined, msg.error)
        else waiter(msg.result)
      }
      if (id === promptInFlightId) {
        promptInFlightId = null
        turnActive = false
        emitAcpUsage(emit, readAcpUsageFromPromptResult(msg.result))
        const stopReason =
          asString(dig(msg.result, 'stopReason')) || asString(dig(msg.result, 'stop_reason'))
        const cancelled = stopReason === 'cancelled' || stopReason === 'canceled'
        const extracted = msg.error ? extractRpcError(msg.error) : null
        emit({
          type: 'turn-finished',
          success: !msg.error && !cancelled,
          cancelled: cancelled || undefined,
          error: extracted?.text,
          errorCode: extracted?.code ?? undefined,
          errorDetail: extracted ? formatErrorDetail(msg.error, extracted.text) : undefined
        })
      }
      return
    }

    const method = asString(msg.method)
    if (!method) return
    const params = asRecord(msg.params) ?? {}

    if (method === 'session/update') {
      const update = asRecord(params.update) ?? params
      const updateKind = sessionUpdateKind(update, params)
      if (!turnActive && !isSessionLevelAcpUpdate(updateKind, update)) return
      const goal = readGoalSnapshotFromUpdate(update)
      if (goal !== undefined) publishSessionState({ goal })
      handleSessionUpdate(
        params,
        emit,
        (steps) => {
          lastTodos = steps
        },
        publishSessionState,
        { kind, advertisedGoal }
      )
      return
    }

    if (method === 'session/request_permission') {
      handlePermissionRequest(msg.id, params, {
        autoApprove,
        pendingClient,
        respond,
        emit
      })
      return
    }

    if (method === 'fs/read_text_file' || method === 'fs/readTextFile') {
      void handleClientMethod(msg.id, async () => {
        if (!options.files) throw new AcpRpcError(RpcErrorCode.methodNotFound, 'fs not available')
        return acpReadTextFile(options.files, params, options.cwd)
      })
      return
    }

    if (method === 'fs/write_text_file' || method === 'fs/writeTextFile') {
      void handleClientMethod(msg.id, async () => {
        if (!options.files) throw new AcpRpcError(RpcErrorCode.methodNotFound, 'fs not available')
        const written = await acpWriteTextFile(options.files, params, options.cwd)
        emit({
          type: 'fs-write',
          path: written.path,
          original: written.original,
          content: written.content
        })
        return null
      })
      return
    }

    if (method === 'terminal/create') {
      void handleClientMethod(msg.id, async () => terminals.create(params, options.cwd))
      return
    }
    if (method === 'terminal/output') {
      void handleClientMethod(msg.id, async () => terminals.output(asString(params.terminalId) || ''))
      return
    }
    if (method === 'terminal/wait_for_exit' || method === 'terminal/waitForExit') {
      void handleClientMethod(msg.id, async () =>
        terminals.waitForExit(asString(params.terminalId) || '')
      )
      return
    }
    if (method === 'terminal/kill') {
      void handleClientMethod(msg.id, async () => terminals.kill(asString(params.terminalId) || ''))
      return
    }
    if (method === 'terminal/release') {
      void handleClientMethod(msg.id, async () => terminals.release(asString(params.terminalId) || ''))
      return
    }

    if (method === 'elicitation/create') {
      handleElicitationCreate(msg.id, params, { pendingClient, emit })
      return
    }

    if (method === 'elicitation/complete') {
      return
    }

    if (isCursorExtMethod(method)) {
      handleCursorExt(method, msg.id, params, {
        pendingClient,
        lastTodos,
        setLastTodos: (steps) => {
          lastTodos = steps
        },
        respond,
        emit
      })
      return
    }

    if (msg.id !== undefined) {
      respondError(msg.id, {
        code: RpcErrorCode.methodNotFound,
        message: `Method not found: ${method}`
      })
    }
  }

  const handleClientMethod = async (
    id: unknown,
    run: () => Promise<unknown>
  ): Promise<void> => {
    if (id === undefined) return
    try {
      respond(id, await run())
    } catch (err) {
      if (err instanceof AcpRpcError) {
        respondError(id, err.toJson())
        return
      }
      respondError(id, {
        code: RpcErrorCode.internalError,
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  onJsonLines(proc.child.stdout, handleInbound)

  proc.child.on('exit', (code) => {
    if (disposed) return
    if (turnActive) {
      emit({
        type: 'turn-finished',
        success: false,
        error: stderrChunks.join('').trim() || `${kind} exited with code ${code}`
      })
      turnActive = false
    }
    emit({ type: 'process-exited', code })
  })

  void bootstrap()

  const doPrompt = async (text: string, extras?: DriverPromptExtras): Promise<void> => {
    if (!sessionId) {
      pendingPrompts.push({ text, extras })
      return
    }
    let promptText = text
    if (resumeFellBack) {
      resumeFellBack = false
      const handoff = options.resumeHandoff?.()?.trim()
      if (handoff) promptText = `${handoff}\n\n${text}`
    }
    // Pin this conversation's model immediately before the prompt. Cursor
    // persists session/set_model as an account default, so a sibling session
    // can otherwise steal Auto / the last pick.
    await queueApplyWantedModel()
    turnActive = true
    emit({ type: 'turn-started' })
    const id = nextId++
    promptInFlightId = id
    pendingRpc.set(id, () => {
      /* settled in onJsonLines */
    })
    let prompt: AcpContentBlock[]
    try {
      prompt = await buildAcpPrompt({
        text: promptText,
        attachments: extras?.attachments,
        capabilities: promptCapabilities
      })
    } catch {
      prompt = [{ type: 'text', text: promptText }]
    }
    send('session/prompt', { sessionId, prompt }, id)
    const slashGoal = applyGoalSlash(sessionState.goal, promptText)
    if (slashGoal !== undefined) publishSessionState({ goal: slashGoal })
  }

  const cancelPending = (outcome: 'cancelled' | 'decline'): void => {
    for (const [key, pending] of pendingClient) {
      if (pending.kind === 'create_plan' || pending.kind === 'ask_question') {
        respond(pending.id, { outcome: { outcome: 'cancelled' } })
      } else if (pending.kind === 'form' || pending.kind === 'url') {
        respond(pending.id, { action: outcome === 'decline' ? 'decline' : 'cancel' })
      }
      pendingClient.delete(key)
    }
  }

  return {
    prompt(text: string, extras?: DriverPromptExtras): void {
      if (!ready) {
        pendingPrompts.push({ text, extras })
        return
      }
      void doPrompt(text, extras)
    },
    steer(text: string): void {
      void doPrompt(text)
    },
    supportsSteer(): boolean {
      return true
    },
    cancel(): void {
      if (sessionId) send('session/cancel', { sessionId })
      cancelPending('cancelled')
    },
    respond(requestId: string, optionId: 'allow' | 'deny', message?: string): void {
      const pending = pendingClient.get(requestId)
      if (pending?.kind === 'create_plan') {
        respond(pending.id, { outcome: planDocOutcomeFromAnswer(message ?? '', optionId === 'deny') })
        pendingClient.delete(requestId)
        return
      }
      if (pending?.kind === 'ask_question') {
        respond(pending.id, {
          outcome:
            optionId === 'deny'
              ? { outcome: 'cancelled' as const }
              : cursorAskOutcomeFromAnswer(pending.ask, message ?? '')
        })
        pendingClient.delete(requestId)
        return
      }
      if (pending?.kind === 'form') {
        if (optionId === 'deny') {
          respond(pending.id, { action: 'decline' })
        } else {
          let content: Record<string, string | number | boolean> = {}
          try {
            const parsed = JSON.parse(message || '{}') as {
              answers?: Array<{ answer?: string; answers?: string[] }>
              content?: Record<string, string | number | boolean>
            }
            content = parsed.content ?? acpFormContentFromAnswers(pending.fields, parsed.answers ?? [])
          } catch {
            content = {}
          }
          respond(pending.id, { action: 'accept', content })
        }
        pendingClient.delete(requestId)
        return
      }
      if (pending?.kind === 'url') {
        respond(pending.id, { action: optionId === 'allow' ? 'accept' : 'decline' })
        pendingClient.delete(requestId)
        return
      }
      const optionsList = pending?.kind === 'permission' ? pending.options : []
      const rawId =
        pending?.kind === 'permission'
          ? pending.id
          : /^\d+$/.test(requestId)
            ? Number(requestId)
            : requestId
      let selected = 'allow_once'
      let reject = 'reject_once'
      for (const opt of optionsList) {
        const r = asRecord(opt)
        const kind = asString(r?.kind) || asString(r?.optionId) || ''
        if (kind.includes('allow')) selected = asString(r?.optionId) || kind
        if (kind.includes('reject') || kind.includes('deny')) reject = asString(r?.optionId) || kind
      }
      respond(rawId, {
        outcome: {
          outcome: 'selected',
          optionId: optionId === 'allow' ? selected : reject
        }
      })
      pendingClient.delete(requestId)
    },
    applyOptions(opts): boolean {
      if (opts.approvalMode) return false
      if (opts.model != null) wantedModel = opts.model.trim() || null
      if (opts.thinkingLevel !== undefined) wantedThinking = opts.thinkingLevel
      if (opts.fast !== undefined) wantedFast = opts.fast
      if (opts.model != null) publishAdvertisedThinkingLevels()
      if (opts.model != null || opts.thinkingLevel !== undefined || opts.fast !== undefined) {
        // A previous overlay may have been rejected before availableModels
        // arrived, or before the user flipped Fast. Retry the current chips.
        rejectedModels.clear()
        void queueApplyWantedModel()
      }
      if (opts.mode && sessionId) {
        void request('session/set_mode', { sessionId, modeId: opts.mode })
          .then(() => publishSessionState({ currentModeId: opts.mode }))
          .catch(() => undefined)
      }
      if (opts.configOption && sessionId) {
        const configOption = opts.configOption
        void request('session/set_config_option', {
          sessionId,
          configId: configOption.id,
          value: configOption.value
        })
          .then((result) => {
            const options = parseAcpConfigOptions(asRecord(result)?.configOptions)
            if (options.length) publishSessionState({ configOptions: options })
            if (configOption.id === 'model' && typeof configOption.value === 'string') {
              publishModelContextSize(configOption.value)
            }
          })
          .catch(() => undefined)
      }
      if (opts.goal && sessionId) {
        const goalReq = opts.goal
        const cap = sessionState.goalCapability
        if (cap && goalUsesRpc(cap, goalReq.action)) {
          const params: Record<string, unknown> = { sessionId, action: goalReq.action }
          if (goalReq.action === 'set' && goalReq.objective?.trim()) {
            params.objective = goalReq.objective.trim()
          }
          void request(cap.controlMethod, params)
            .then(() => {
              const next = optimisticGoal(sessionState.goal, goalReq.action, goalReq.objective)
              if (next !== undefined) publishSessionState({ goal: next })
            })
            .catch((err) => {
              const extracted = extractRpcError(err)
              emit({
                type: 'error',
                message: extracted.text || 'Goal control failed',
                errorCode: extracted.code ?? undefined,
                errorDetail: formatErrorDetail(err, extracted.text)
              })
            })
        }
      }
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      cancelPending('cancelled')
      terminals.disposeAll()
      if (sessionId) {
        if (canLogout) {
          void request('logout', {}).catch(() => undefined)
        }
        send('session/close', { sessionId }, nextId++)
      }
      disposeStdioProcess(proc)
    }
  }
}

function sessionUpdateKind(
  update: Record<string, unknown>,
  params?: Record<string, unknown>
): string {
  return (
    asString(update.sessionUpdate) ||
    asString(update.session_update) ||
    asString(params?.sessionUpdate) ||
    ''
  )
}

function handleSessionUpdate(
  params: Record<string, unknown>,
  emit: DriverEventSink,
  onPlanSteps?: (steps: PlanStep[]) => void,
  onSessionState?: (patch: Partial<AcpSessionState>) => void,
  goalHost?: { kind: AcpHostKind; advertisedGoal: GoalCapability | null }
): void {
  const update = asRecord(params.update) ?? params
  const kind = sessionUpdateKind(update, params)
  const norm = normalizeUpdateKind(kind)

  if (kind === 'agent_message_chunk' || norm === 'agentmessagechunk') {
    const text = asString(dig(update, 'content.text')) || asString(update.text) || ''
    if (text) emit({ type: 'text-delta', text })
    return
  }
  if (kind === 'agent_thought_chunk' || norm === 'agentthoughtchunk') {
    const text = asString(dig(update, 'content.text')) || asString(update.text) || ''
    if (text) emit({ type: 'reasoning-delta', text })
    return
  }
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const id = asString(update.toolCallId) || asString(update.tool_call_id) || `tool-${Date.now()}`
    const name = asString(update.name) || asString(update.kind) || asString(update.title) || 'tool'
    const title = asString(update.title) || undefined
    const statusRaw = asString(update.status) || ''
    let status: 'started' | 'updated' | 'completed' | 'error' = 'started'
    if (kind === 'tool_call_update') {
      if (statusRaw === 'completed' || statusRaw === 'success') status = 'completed'
      else if (statusRaw === 'failed' || statusRaw === 'error') status = 'error'
      else status = 'updated'
    }
    const output = toolResultText(asArray(update.content)) || asString(update.rawOutput) || undefined
    emit({
      type: 'tool',
      id,
      name,
      title,
      input: update.rawInput ?? update.input ?? {},
      status,
      output
    })
    return
  }
  if (kind === 'plan') {
    const steps = acpPlanEntriesToSteps(update.entries ?? update.steps)
    onPlanSteps?.(steps)
    const open = steps.some((step) => step.status === 'pending' || step.status === 'executing')
    emit({
      type: 'tool',
      id: ACP_PLAN_ID,
      name: 'plan',
      input: {
        title: asString(update.title) || 'Plan',
        steps
      },
      status: open ? 'updated' : 'completed'
    })
    return
  }

  if (norm === 'availablecommandsupdate') {
    const commands = seedGoalCommands(goalHost?.kind ?? '', parseAcpAvailableCommands(update))
    onSessionState?.({
      commands,
      goalCapability: resolveGoalCapability(
        goalHost?.kind ?? '',
        goalHost?.advertisedGoal ?? null,
        commands
      )
    })
    return
  }
  if (norm === 'currentmodeupdate') {
    onSessionState?.({
      currentModeId: asString(update.modeId) || asString(update.currentModeId) || asString(update.mode)
    })
    return
  }
  if (norm === 'configoptionupdate') {
    onSessionState?.({ configOptions: parseAcpConfigOptions(update) })
    return
  }
  if (norm === 'sessioninfoupdate') {
    const goal = readGoalSnapshotFromUpdate(update)
    onSessionState?.({
      sessionTitle: asString(update.title) || asString(dig(update, 'sessionInfo.title')),
      ...(goal !== undefined ? { goal } : {})
    })
    return
  }
  if (kind === 'user_message_chunk' || norm === 'usermessagechunk') return

  if (norm === 'usageupdate') {
    emitAcpUsage(emit, readAcpUsageFromUpdate(update), { recordHistory: false })
    return
  }

  if (kind === 'state_update' || asRecord(update.usage)) {
    emitAcpUsage(emit, readAcpUsageFromUpdate(update))
  }
}

function emitAcpUsage(
  emit: DriverEventSink,
  sample: AcpUsageSample | null,
  extras?: { recordHistory?: boolean }
): void {
  if (!sample) return
  emit({
    type: 'usage',
    ...sample,
    ...(extras?.recordHistory === false ? { recordHistory: false } : {})
  })
}

function normalizeRpcMethod(method: string): string {
  return method.toLowerCase().replace(/_/g, '')
}

function isCursorExtMethod(method: string): boolean {
  const n = normalizeRpcMethod(method)
  return (
    n.startsWith('cursor/') ||
    n.endsWith('/createplan') ||
    n.endsWith('/askquestion') ||
    n.endsWith('/updatetodos') ||
    n === 'createplan' ||
    n === 'askquestion'
  )
}

function handlePermissionRequest(
  requestId: unknown,
  params: Record<string, unknown>,
  ctx: {
    autoApprove: boolean
    pendingClient: Map<string, PendingClient>
    respond: (id: unknown, result: unknown) => void
    emit: DriverEventSink
  }
): void {
  if (requestId === undefined) return
  const toolCall = asRecord(params.toolCall) ?? params
  const toolName =
    asString(toolCall.name) || asString(toolCall.kind) || asString(toolCall.title) || 'tool'
  const rawInput = asRecord(toolCall.rawInput) ?? asRecord(toolCall.input) ?? toolCall
  if (
    (isPlanDocToolName(toolName) || isPlanDocToolName(asString(rawInput._toolName) ?? '')) &&
    planDocHasBody(normalizePlanDocInput(rawInput))
  ) {
    handleCreatePlan(requestId, { ...rawInput, toolCallId: asString(toolCall.toolCallId) }, ctx)
    return
  }
  const optionsList =
    asArray(params.options) ?? asArray(dig(params, 'toolCall.permissionOptions')) ?? []
  if (ctx.autoApprove) {
    const always =
      optionsList.find((o) => {
        const r = asRecord(o)
        const kind = asString(r?.kind) || asString(r?.optionId)
        return kind === 'allow_always' || kind === 'allow-always' || kind === 'allow_once'
      }) ?? optionsList[0]
    const optionId =
      asString(asRecord(always)?.optionId) || asString(asRecord(always)?.kind) || 'allow_once'
    ctx.respond(requestId, { outcome: { outcome: 'selected', optionId } })
    return
  }
  const key = String(requestId)
  ctx.pendingClient.set(key, { kind: 'permission', id: requestId, options: optionsList })
  ctx.emit({
    type: 'permission',
    requestId: key,
    toolName,
    summary: asString(toolCall.title) || toolName,
    detail: toolResultText(asArray(toolCall.content)) || asString(toolCall.rawInput) || undefined,
    input: toolCall
  })
}

function handleElicitationCreate(
  requestId: unknown,
  params: Record<string, unknown>,
  ctx: {
    pendingClient: Map<string, PendingClient>
    emit: DriverEventSink
  }
): void {
  if (requestId === undefined) return
  const mode = asString(params.mode) || 'form'
  const toolCallId =
    asString(params.toolCallId) ||
    asString(params.elicitationId) ||
    `elicit-${String(requestId)}`
  const title = asString(params.message) || asString(params.title) || 'Question'
  if (mode === 'url') {
    const url = asString(params.url) || ''
    const key = String(requestId)
    ctx.pendingClient.set(key, {
      kind: 'url',
      id: requestId,
      toolCallId,
      elicitationId: asString(params.elicitationId) ?? undefined
    })
    ctx.emit({
      type: 'elicitation',
      requestId: key,
      toolCallId,
      kind: 'url',
      title,
      input: { url, message: title, elicitationId: params.elicitationId }
    })
    return
  }
  const fields = parseAcpFormSchema(params.requestedSchema ?? params.schema)
  const key = String(requestId)
  ctx.pendingClient.set(key, { kind: 'form', id: requestId, toolCallId, fields })
  ctx.emit({
    type: 'elicitation',
    requestId: key,
    toolCallId,
    kind: 'form',
    title,
    input: {
      message: title,
      requestedSchema: params.requestedSchema ?? params.schema,
      fields,
      questions: fields.map((field) => ({
        question: field.title,
        choices: field.enum,
        multiSelect: false
      }))
    }
  })
}

function handleCursorExt(
  method: string,
  requestId: unknown,
  params: Record<string, unknown>,
  ctx: {
    pendingClient: Map<string, PendingClient>
    lastTodos: PlanStep[]
    setLastTodos: (steps: PlanStep[]) => void
    respond: (id: unknown, result: unknown) => void
    emit: DriverEventSink
  }
): void {
  const n = normalizeRpcMethod(method)
  if (n === 'cursor/createplan' || n === 'createplan' || n.endsWith('/createplan')) {
    handleCreatePlan(requestId, params, ctx)
    return
  }
  if (n === 'cursor/askquestion' || n === 'askquestion' || n.endsWith('/askquestion')) {
    handleAskQuestion(requestId, params, ctx)
    return
  }
  if (n === 'cursor/updatetodos' || n.endsWith('/updatetodos')) {
    const incoming = todosToSteps(params.todos)
    const next = mergeTodos(ctx.lastTodos, incoming, params.merge !== true)
    ctx.setLastTodos(next)
    const open = next.some((step) => step.status === 'pending' || step.status === 'executing')
    ctx.emit({
      type: 'tool',
      id: asString(params.toolCallId) || CURSOR_TODOS_ID,
      name: 'update_todos',
      input: { title: asString(params.title) || 'Plan', steps: next },
      status: open ? 'updated' : 'completed'
    })
    return
  }
  if (n === 'cursor/task') {
    const id = asString(params.toolCallId) || `task-${Date.now()}`
    const done = params.durationMs != null || asString(params.agentId)
    ctx.emit({
      type: 'tool',
      id,
      name: 'task',
      title: asString(params.description) || undefined,
      input: params,
      status: done ? 'completed' : 'started',
      output: asString(params.description) || undefined
    })
    return
  }
  if (n === 'cursor/generateimage') {
    const id = asString(params.toolCallId) || `image-${Date.now()}`
    ctx.emit({
      type: 'tool',
      id,
      name: 'generate_image',
      title: asString(params.description) || asString(params.filePath) || undefined,
      input: params,
      status: 'completed',
      output: asString(params.filePath) || asString(params.description) || ''
    })
    return
  }
  if (requestId !== undefined) {
    ctx.respond(requestId, { outcome: { outcome: 'cancelled' } })
  }
}

function handleCreatePlan(
  requestId: unknown,
  params: Record<string, unknown>,
  ctx: {
    pendingClient: Map<string, PendingClient>
    respond: (id: unknown, result: unknown) => void
    emit: DriverEventSink
    lastTodos?: PlanStep[]
    setLastTodos?: (steps: PlanStep[]) => void
  }
): void {
  const doc = normalizePlanDocInput(params)
  const toolCallId =
    asString(params.toolCallId) ||
    (requestId !== undefined ? `plan-doc-${String(requestId)}` : `plan-doc-${Date.now()}`)
  ctx.emit({
    type: 'tool',
    id: toolCallId,
    name: 'create_plan',
    title: doc.name,
    input: { ...doc, toolCallId },
    status: requestId === undefined ? 'completed' : 'started'
  })
  if (doc.todos.length) ctx.setLastTodos?.(doc.todos)
  if (requestId === undefined) {
    if (doc.todos.length) {
      ctx.emit({
        type: 'tool',
        id: CURSOR_TODOS_ID,
        name: 'plan',
        input: planDocToChecklistInput(doc),
        status: 'updated'
      })
    }
    return
  }
  const key = String(requestId)
  ctx.pendingClient.set(key, { kind: 'create_plan', id: requestId, toolCallId })
  ctx.emit({
    type: 'elicitation',
    requestId: key,
    toolCallId,
    kind: 'plan_doc',
    title: doc.name,
    input: { ...doc, toolCallId }
  })
}

function handleAskQuestion(
  requestId: unknown,
  params: Record<string, unknown>,
  ctx: {
    pendingClient: Map<string, PendingClient>
    respond: (id: unknown, result: unknown) => void
    emit: DriverEventSink
  }
): void {
  const ask = normalizeCursorAskInput(params)
  const toolCallId =
    asString(params.toolCallId) ||
    (requestId !== undefined ? `ask-${String(requestId)}` : `ask-${Date.now()}`)
  const input = { ...cursorAskToToolInput(ask), toolCallId }
  ctx.emit({
    type: 'tool',
    id: toolCallId,
    name: 'ask_user_question',
    title: ask.title,
    input,
    status: requestId === undefined ? 'completed' : 'started'
  })
  if (requestId === undefined) return
  const key = String(requestId)
  ctx.pendingClient.set(key, { kind: 'ask_question', id: requestId, toolCallId, ask })
  ctx.emit({
    type: 'elicitation',
    requestId: key,
    toolCallId,
    kind: 'ask',
    title: ask.title,
    input
  })
}

function toolResultText(content: unknown[] | null): string {
  if (!content) return ''
  const parts: string[] = []
  for (const item of content) {
    if (typeof item === 'string') {
      parts.push(item)
      continue
    }
    const r = asRecord(item)
    if (!r) continue
    const t = asString(r.type)
    if (t === 'text' || t === 'content') {
      const text = asString(r.text) || asString(dig(r, 'content.text'))
      if (text) parts.push(text)
    } else if (t === 'diff') {
      parts.push(asString(r.diff) || asString(r.text) || '[diff]')
    } else if (t === 'terminal') {
      parts.push(asString(r.terminalId) ? `[terminal ${asString(r.terminalId)}]` : '[terminal]')
    } else if (asString(r.text)) {
      parts.push(asString(r.text)!)
    }
  }
  return parts.join('\n')
}
