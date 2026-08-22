import type { ApprovalMode, CliHostKind, PlanStep } from '@shared/types'
import { extractRpcError, formatErrorDetail } from '@shared/cliErrors'
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
} from '@shared/planDoc'
import { costToUsd } from '@shared/tokenUsage'
import {
  asArray,
  asRecord,
  asString,
  dig,
  num,
  onJsonLines,
  spawnStdioProcess,
  type StdioProcess
} from './process'
import type { DriverControl, DriverEventSink, DriverStartOptions } from './types'

const ACP_PLAN_ID = 'acp-session-plan'
const CURSOR_TODOS_ID = 'cursor-todos'

type PendingClient =
  | { kind: 'permission'; id: unknown; options: unknown[] }
  | { kind: 'create_plan'; id: unknown; toolCallId: string }
  | { kind: 'ask_question'; id: unknown; toolCallId: string; ask: CursorAskInput }

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
      // --trust-all-tools skips interactive approvals when we auto-approve.
      return approvalMode === 'bypass' || approvalMode === 'auto'
        ? ['acp', '--trust-all-tools']
        : ['acp']
    case 'cline':
      return approvalMode === 'bypass' || approvalMode === 'auto'
        ? ['--acp', '--auto-approve', 'true']
        : ['--acp']
  }
}

/**
 * Agent Client Protocol over stdio.
 *
 * - Cursor: `cursor-agent acp`
 * - Grok:   `grok agent stdio`
 * - Devin:  `devin acp`
 * - Kiro:   `kiro-cli acp`
 * - Cline:  `cline --acp`
 *
 * Do NOT advertise fs/terminal client capabilities — we don't serve them.
 */
export async function startAcpDriver(
  kind: AcpHostKind,
  options: DriverStartOptions,
  emit: DriverEventSink
): Promise<DriverControl> {
  const args = acpArgs(kind, options.approvalMode)
  const proc = spawnStdioProcess(options.binary, args, options.cwd, options.env)
  return wireAcp(kind, proc, options, emit)
}

function wireAcp(
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
  const pendingPrompts: string[] = []
  const pendingRpc = new Map<number, (result: unknown, error?: unknown) => void>()
  const pendingClient = new Map<string, PendingClient>()
  const stderrChunks: string[] = []
  const autoApprove = options.approvalMode === 'bypass' || options.approvalMode === 'auto'
  let lastTodos: PlanStep[] = []

  const send = (method: string, params: Record<string, unknown>, id?: number): void => {
    const payload: Record<string, unknown> = { jsonrpc: '2.0', method, params }
    if (id !== undefined) payload.id = id
    proc.writeLine(payload)
  }

  const request = (
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> => {
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

  proc.child.stderr.on('data', (buf: Buffer) => {
    stderrChunks.push(buf.toString('utf8'))
    if (stderrChunks.length > 40) stderrChunks.shift()
  })

  const bootstrap = async (): Promise<void> => {
    try {
      const init = asRecord(
        await request('initialize', {
          protocolVersion: 1,
          clientCapabilities: {
            // Intentionally empty — advertising fs/terminal we cannot honor
            // strands the agent mid-tool-call (Waku docs).
          },
          clientInfo: { name: 'vav', version: '1.0.0' }
        })
      )
      send('initialized', {})

      const caps = asRecord(init?.agentCapabilities) ?? asRecord(init?.capabilities)
      const authMethods = asArray(init?.authMethods)

      // Resume / load / new session
      if (sessionId) {
        try {
          if (caps && (caps.loadSession === true || dig(caps, 'session.loadSession'))) {
            await request('session/load', {
              sessionId,
              cwd: options.cwd,
              mcpServers: []
            })
          } else {
            await request('session/resume', { sessionId, cwd: options.cwd })
          }
        } catch {
          sessionId = null
        }
      }
      if (!sessionId) {
        const created = asRecord(
          await request('session/new', {
            cwd: options.cwd,
            mcpServers: []
          })
        )
        sessionId =
          asString(created?.sessionId) ||
          asString(created?.session_id) ||
          asString(dig(created, 'session.id'))
      }

      if (!sessionId) {
        emit({ type: 'error', message: `${kind} ACP session/new returned no sessionId` })
        return
      }

      // Do not force `agent`. Cursor ACP also has `plan` / `ask`; overwriting
      // the host default hid create_plan and left the tool card hanging.

      if (options.model) {
        try {
          await request('session/set_model', { sessionId, modelId: options.model })
        } catch {
          /* optional */
        }
      }

      ready = true
      emit({ type: 'connected', cursor: { provider: kind, sessionId } })
      void authMethods
      for (const prompt of pendingPrompts.splice(0)) void doPrompt(prompt)
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

  onJsonLines(proc.child.stdout, (value) => {
    const msg = asRecord(value)
    if (!msg) return

    // Response to our request
    if (msg.id !== undefined && msg.method === undefined) {
      const id = typeof msg.id === 'number' ? msg.id : Number(msg.id)
      const waiter = pendingRpc.get(id)
      if (waiter) {
        pendingRpc.delete(id)
        if (msg.error) waiter(undefined, msg.error)
        else waiter(msg.result)
      }
      // session/prompt response settles the turn
      if (id === promptInFlightId) {
        promptInFlightId = null
        turnActive = false
        const stopReason = asString(dig(msg.result, 'stopReason')) || asString(dig(msg.result, 'stop_reason'))
        const cancelled = stopReason === 'cancelled' || stopReason === 'canceled'
        const extracted = msg.error ? extractRpcError(msg.error) : null
        emit({
          type: 'turn-finished',
          success: !msg.error && !cancelled,
          cancelled: cancelled || undefined,
          // Keep the RPC error even when the host also marks the turn cancelled
          // (Grok 402 often arrives as both). The host prefers quota over cancel.
          error: extracted?.text,
          errorCode: extracted?.code ?? undefined,
          errorDetail: extracted
            ? formatErrorDetail(msg.error, extracted.text)
            : undefined
        })
      }
      return
    }

    const method = asString(msg.method)
    if (!method) return
    const params = asRecord(msg.params) ?? {}

    if (method === 'session/update') {
      handleSessionUpdate(params, emit, (steps) => {
        lastTodos = steps
      })
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

    // Agent-to-client request we do not implement. Answering prevents a hang.
    if (msg.id !== undefined) {
      proc.writeLine({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${method}` }
      })
    }
  })

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

  const doPrompt = async (text: string): Promise<void> => {
    if (!sessionId) {
      pendingPrompts.push(text)
      return
    }
    turnActive = true
    emit({ type: 'turn-started' })
    const id = nextId++
    promptInFlightId = id
    pendingRpc.set(id, () => {
      /* settled in onJsonLines */
    })
    send(
      'session/prompt',
      {
        sessionId,
        prompt: [{ type: 'text', text }]
      },
      id
    )
  }

  return {
    prompt(text: string): void {
      if (!ready) {
        pendingPrompts.push(text)
        return
      }
      void doPrompt(text)
    },
    steer(text: string): void {
      // Second session/prompt while one is open — last prompt settles.
      void doPrompt(text)
    },
    supportsSteer(): boolean {
      return true
    },
    cancel(): void {
      if (sessionId) send('session/cancel', { sessionId })
      for (const [key, pending] of pendingClient) {
        if (pending.kind === 'create_plan') {
          respond(pending.id, { outcome: { outcome: 'cancelled' } })
        } else if (pending.kind === 'ask_question') {
          respond(pending.id, { outcome: { outcome: 'cancelled' } })
        }
        pendingClient.delete(key)
      }
    },
    respond(requestId: string, optionId: 'allow' | 'deny', message?: string): void {
      const pending = pendingClient.get(requestId)
      if (pending?.kind === 'create_plan') {
        const outcome = planDocOutcomeFromAnswer(message ?? '', optionId === 'deny')
        respond(pending.id, { outcome })
        pendingClient.delete(requestId)
        return
      }
      if (pending?.kind === 'ask_question') {
        const outcome =
          optionId === 'deny'
            ? { outcome: 'cancelled' as const }
            : cursorAskOutcomeFromAnswer(pending.ask, message ?? '')
        respond(pending.id, { outcome })
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
      if (opts.model && sessionId) {
        void request('session/set_model', { sessionId, modelId: opts.model }).catch(() => undefined)
      }
      if (opts.mode && sessionId) {
        void request('session/set_mode', { sessionId, modeId: opts.mode }).catch(() => undefined)
      }
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      for (const [key, pending] of pendingClient) {
        if (pending.kind === 'create_plan') {
          respond(pending.id, { outcome: { outcome: 'cancelled' } })
        } else if (pending.kind === 'ask_question') {
          respond(pending.id, { outcome: { outcome: 'cancelled' } })
        }
        pendingClient.delete(key)
      }
      proc.closeStdin()
      setTimeout(() => proc.kill(), 2_000)
    }
  }
}

function handleSessionUpdate(
  params: Record<string, unknown>,
  emit: DriverEventSink,
  onPlanSteps?: (steps: PlanStep[]) => void
): void {
  const update = asRecord(params.update) ?? params
  const kind =
    asString(update.sessionUpdate) ||
    asString(update.session_update) ||
    asString(params.sessionUpdate)

  if (kind === 'agent_message_chunk' || kind === 'agent_message_chunk'.replace(/_/g, '')) {
    const text = asString(dig(update, 'content.text')) || asString(update.text) || ''
    if (text) emit({ type: 'text-delta', text })
    return
  }
  if (kind === 'agent_thought_chunk') {
    const text = asString(dig(update, 'content.text')) || asString(update.text) || ''
    if (text) emit({ type: 'reasoning-delta', text })
    return
  }
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const id = asString(update.toolCallId) || asString(update.tool_call_id) || `tool-${Date.now()}`
    // ACP: `name` is the programmatic tool id (RFD tool-call-name), `kind` the coarse
    // ToolKind category, `title` human UI copy — only the first two map to ToolName.
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

  if (
    kind === 'available_commands_update' ||
    kind === 'current_mode_update' ||
    kind === 'config_option_update' ||
    kind === 'session_info_update' ||
    kind === 'user_message_chunk'
  ) {
    return
  }

  // ACP session context + optional cumulative cost (RFD: session-usage).
  if (kind === 'usage_update') {
    const sample = acpUsageSample(update)
    if (!sample) return
    emit({
      type: 'usage',
      ...sample,
      recordHistory: false
    })
    return
  }

  // Draft end-turn token usage (may appear on idle state_update / prompt result).
  if (kind === 'state_update' || asRecord(update.usage)) {
    const usage = asRecord(update.usage)
    if (!usage) return
    const input = num(usage.inputTokens) ?? num(usage.input_tokens)
    const output = num(usage.outputTokens) ?? num(usage.output_tokens)
    const cacheRead = num(usage.cachedReadTokens) ?? num(usage.cached_read_tokens)
    const cacheWrite = num(usage.cachedWriteTokens) ?? num(usage.cached_write_tokens)
    if (input == null && output == null && cacheRead == null && cacheWrite == null) return
    const contextUsed = (input ?? 0) + (cacheRead ?? 0)
    emit({
      type: 'usage',
      inputTokens: input,
      outputTokens: output,
      cacheRead,
      cacheWrite,
      contextUsed: contextUsed > 0 ? contextUsed : undefined
    })
  }
}

function firstNum(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = num(value)
    if (n != null) return n
  }
  return undefined
}

/** Cursor / Grok / other ACP hosts disagree on usage_update field names. */
function acpUsageSample(update: Record<string, unknown>): {
  contextUsed?: number
  contextSize?: number
  inputTokens?: number
  outputTokens?: number
  cacheRead?: number
  cacheWrite?: number
  sessionCostUsd?: number
} | null {
  const tokens = asRecord(update.tokens) ?? asRecord(update.usage)
  const context = asRecord(update.context)
  const used = firstNum(
    update.used,
    update.usedTokens,
    update.contextUsed,
    tokens?.used,
    tokens?.usedTokens,
    context?.used
  )
  const size = firstNum(
    update.size,
    update.maxTokens,
    update.contextSize,
    update.contextWindow,
    tokens?.size,
    tokens?.maxTokens,
    context?.size
  )
  const input = firstNum(update.inputTokens, update.input_tokens, tokens?.inputTokens, tokens?.input)
  const output = firstNum(
    update.outputTokens,
    update.output_tokens,
    tokens?.outputTokens,
    tokens?.output
  )
  const cacheRead = firstNum(
    update.cacheRead,
    update.cachedReadTokens,
    update.cache_read,
    tokens?.cacheRead,
    tokens?.cached
  )
  const cacheWrite = firstNum(
    update.cacheWrite,
    update.cachedWriteTokens,
    update.cache_write,
    tokens?.cacheWrite
  )
  const cost = asRecord(update.cost)
  const amount = num(cost?.amount)
  const currency = asString(cost?.currency)
  const sessionCostUsd =
    amount != null ? costToUsd(amount, currency ?? 'USD') : undefined
  const contextUsed = used ?? ((input ?? 0) + (cacheRead ?? 0) > 0 ? (input ?? 0) + (cacheRead ?? 0) : undefined)
  if (
    contextUsed == null &&
    size == null &&
    input == null &&
    output == null &&
    cacheRead == null &&
    cacheWrite == null &&
    sessionCostUsd == null
  ) {
    return null
  }
  return {
    contextUsed,
    contextSize: size,
    inputTokens: input,
    outputTokens: output,
    cacheRead,
    cacheWrite,
    sessionCostUsd: sessionCostUsd ?? undefined
  }
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
  const optionsList = asArray(params.options) ?? asArray(dig(params, 'toolCall.permissionOptions')) ?? []
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
  const toolCallId = asString(params.toolCallId) || (requestId !== undefined ? `plan-doc-${String(requestId)}` : `plan-doc-${Date.now()}`)
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
    } else if (asString(r.text)) {
      parts.push(asString(r.text)!)
    }
  }
  return parts.join('\n')
}
