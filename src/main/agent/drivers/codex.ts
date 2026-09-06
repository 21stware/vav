import type { ApprovalMode, QuotaWindow } from '@shared/types'
import { extractRpcError, extractRpcErrorText } from '@shared/cliErrors'
import { parseHostTransportStatus } from '@shared/turnRecovery'
import {
  classifyCodexRateLimitWindowKinds,
  codexWindowMinutesFromRecord,
  normalizeQuotaPercent,
  parseQuotaResetsAt
} from '@shared/tokenUsage'
import {
  asArray,
  asRecord,
  asString,
  dig,
  num,
  onJsonLines,
  disposeStdioProcess,
  spawnStdioProcess,
  type StdioProcess
} from './process'
import type { DriverControl, DriverEventSink, DriverStartOptions } from './types'

function codexPermissions(mode: ApprovalMode): {
  approvalPolicy: string
  sandbox: string
  approvalsReviewer: string
} {
  switch (mode) {
    case 'bypass':
      return {
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
        approvalsReviewer: 'user'
      }
    case 'auto':
      return {
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
        approvalsReviewer: 'user'
      }
    case 'edit':
    default:
      return {
        approvalPolicy: 'untrusted',
        sandbox: 'read-only',
        approvalsReviewer: 'user'
      }
  }
}

function sandboxPolicy(sandbox: string): Record<string, unknown> {
  switch (sandbox) {
    case 'danger-full-access':
      return { type: 'dangerFullAccess' }
    case 'workspace-write':
      return { type: 'workspaceWrite' }
    case 'read-only':
    default:
      return { type: 'readOnly' }
  }
}

/**
 * Codex CLI app-server — JSON-RPC over stdio.
 * `codex app-server --stdio`
 */
export async function startCodexDriver(
  options: DriverStartOptions,
  emit: DriverEventSink
): Promise<DriverControl> {
  const proc = spawnStdioProcess(
    options.binary,
    ['app-server', '--stdio'],
    options.cwd,
    options.env,
    options.hostProcess
  )
  return wireCodex(proc, options, emit)
}

function wireCodex(
  proc: StdioProcess,
  options: DriverStartOptions,
  emit: DriverEventSink
): DriverControl {
  let disposed = false
  let nextId = 1
  let threadId: string | null =
    options.cursor?.provider === 'codex' ? options.cursor.threadId : null
  let turnId: string | null = null
  let turnActive = false
  let ready = false
  const pendingPrompts: string[] = []
  const perms = codexPermissions(options.approvalMode)
  const model = options.model ?? null
  const stderrChunks: string[] = []

  const rpc = (method: string, params: Record<string, unknown>, id?: number | string): void => {
    const payload: Record<string, unknown> = { method, params }
    if (id !== undefined) payload.id = id
    proc.writeLine(payload)
  }

  const request = (method: string, params: Record<string, unknown>): number => {
    const id = nextId++
    rpc(method, params, id)
    return id
  }

  // Handshake
  rpc(
    'initialize',
    {
      clientInfo: { name: 'vav', title: 'VAV', version: '1.0.0' },
      capabilities: { experimentalApi: true }
    },
    0
  )
  rpc('initialized', {})

  const openThread = (): void => {
    const base: Record<string, unknown> = {
      cwd: options.cwd,
      approvalPolicy: perms.approvalPolicy,
      sandbox: perms.sandbox,
      approvalsReviewer: perms.approvalsReviewer
    }
    if (model) base.model = model
    if (threadId) {
      request('thread/resume', { ...base, threadId })
    } else {
      request('thread/start', base)
    }
  }
  openThread()

  proc.child.stderr.on('data', (buf: Buffer) => {
    stderrChunks.push(buf.toString('utf8'))
    if (stderrChunks.length > 40) stderrChunks.shift()
  })

  onJsonLines(proc.child.stdout, (value) => {
    const msg = asRecord(value)
    if (!msg) return

    // JSON-RPC response (has id, no method)
    if (msg.id !== undefined && msg.method === undefined) {
      const result = asRecord(msg.result)
      const thread = asRecord(result?.thread) ?? asRecord(dig(result, 'thread'))
      const id = asString(thread?.id) || asString(result?.threadId) || asString(result?.id)
      if (id && !ready) {
        threadId = id
        ready = true
        emit({ type: 'connected', cursor: { provider: 'codex', threadId: id } })
        for (const prompt of pendingPrompts.splice(0)) startTurn(prompt)
      }
      if (asRecord(msg.error)) {
        const extracted = extractRpcError(msg.error)
        emit({
          type: 'error',
          message: extracted.text,
          errorCode: extracted.code ?? undefined
        })
      }
      return
    }

    const method = asString(msg.method)
    if (!method) return
    const params = asRecord(msg.params) ?? msg

    // Approval request — JSON-RPC request from server (has id + method)
    if (method.includes('requestApproval') || method.endsWith('Approval')) {
      const requestId = String(msg.id ?? '')
      if (!requestId) return
      if (options.approvalMode === 'bypass' || options.approvalMode === 'auto') {
        proc.writeLine({ id: msg.id, result: { decision: 'accept' } })
        return
      }
      const toolName =
        asString(params.tool) ||
        asString(params.toolName) ||
        asString(dig(params, 'item.type')) ||
        'tool'
      const summary =
        asString(params.reason) ||
        asString(params.command) ||
        asString(dig(params, 'item.command')) ||
        toolName
      emit({
        type: 'permission',
        requestId,
        toolName,
        summary,
        input: params
      })
      return
    }

    if (method === 'turn/started') {
      turnActive = true
      turnId = asString(params.turnId) || asString(dig(params, 'turn.id')) || turnId
      emit({ type: 'turn-started' })
      return
    }

    if (
      method === 'item/agentMessage/delta' ||
      method === 'item/agentMessageDelta' ||
      method.endsWith('agentMessage/delta')
    ) {
      const text = asString(params.delta) || asString(params.text) || ''
      if (text) emit({ type: 'text-delta', text })
      return
    }

    if (
      method.includes('reasoning') &&
      (method.includes('delta') || method.includes('Delta'))
    ) {
      const text =
        asString(params.delta) || asString(params.text) || asString(params.summary) || ''
      if (text) emit({ type: 'reasoning-delta', text })
      return
    }

    if (method === 'item/started' || method === 'item/completed') {
      const item = asRecord(params.item) ?? params
      const itemType = asString(item.type) || asString(params.type) || 'tool'
      const id =
        asString(item.id) ||
        asString(params.itemId) ||
        asString(params.id) ||
        `${itemType}-${Date.now()}`
      if (itemType === 'agentMessage' || itemType === 'agent_message' || itemType === 'reasoning') {
        return
      }
      const name = codexItemToolName(itemType, item)
      const input =
        asRecord(item) ??
        ({
          command: asString(item.command),
          path: asString(item.path) || asString(item.file)
        } as Record<string, unknown>)
      const done = method === 'item/completed'
      const failed = item.status === 'failed' || params.status === 'failed'
      emit({
        type: 'tool',
        id,
        name,
        title: asString(item.title) || asString(item.explanation) || undefined,
        input,
        status: done ? (failed ? 'error' : 'completed') : 'started',
        output: done
          ? asString(item.output) ||
            asString(item.aggregatedOutput) ||
            asString(item.text) ||
            asString(item.plan) ||
            undefined
          : undefined
      })
      return
    }

    if (method === 'turn/completed') {
      turnActive = false
      const status = asString(params.status) || asString(dig(params, 'turn.status'))
      const interrupted = /^(?:aborted|interrupted|cancell?ed|stopped)$/i.test(status ?? '')
      emit({
        type: 'turn-finished',
        success: interrupted || status === 'completed' || status === 'success' || !status,
        cancelled: interrupted || undefined
      })
      return
    }

    if (method === 'thread/tokenUsage/updated') {
      const tokenUsage = asRecord(params.tokenUsage) ?? asRecord(params)
      const last = asRecord(tokenUsage?.last) ?? asRecord(dig(params, 'tokenUsage.last'))
      const window =
        num(tokenUsage?.modelContextWindow) ??
        num(dig(params, 'tokenUsage.modelContextWindow'))
      const rateLimits =
        asRecord(params.rateLimits) ??
        asRecord(params.rate_limits) ??
        asRecord(tokenUsage?.rateLimits) ??
        asRecord(tokenUsage?.rate_limits)
      const quotaWindows = rateLimits ? quotaWindowsFromCodexRateLimits(rateLimits) : []
      if (!last && window == null && quotaWindows.length === 0) return
      const input = num(last?.inputTokens) ?? 0
      const cached = num(last?.cachedInputTokens) ?? 0
      const cacheWrite = num(last?.cacheWriteInputTokens) ?? 0
      const output = num(last?.outputTokens) ?? 0
      const contextUsed = input + cached
      if (quotaWindows.length && !last && window == null) {
        emit({ type: 'quota', windows: quotaWindows })
        return
      }
      emit({
        type: 'usage',
        inputTokens: input,
        outputTokens: output,
        cacheRead: cached,
        cacheWrite,
        contextUsed: contextUsed > 0 ? contextUsed : undefined,
        contextSize: window ?? undefined,
        recordHistory: input > 0 || output > 0 || cached > 0 || cacheWrite > 0,
        quotaWindows: quotaWindows.length ? quotaWindows : undefined
      })
      return
    }

    if (
      method === 'thread/rateLimits/updated' ||
      method === 'thread/rate_limits/updated' ||
      method.endsWith('rateLimits/updated') ||
      method.endsWith('rate_limits/updated')
    ) {
      const rateLimits =
        asRecord(params.rateLimits) ??
        asRecord(params.rate_limits) ??
        asRecord(params)
      const windows = rateLimits ? quotaWindowsFromCodexRateLimits(rateLimits) : []
      if (windows.length) emit({ type: 'quota', windows })
      return
    }

    if (method === 'error') {
      const message = extractRpcErrorText(params) || JSON.stringify(params)
      const parsed = parseHostTransportStatus(message)
      if (parsed && turnActive) {
        emit({
          type: 'transport',
          status: parsed.kind,
          attempt: parsed.attempt,
          limit: parsed.limit
        })
        return
      }
      emit({
        type: 'error',
        message
      })
    }
  })

  proc.child.on('exit', (code) => {
    if (disposed) return
    if (turnActive) {
      emit({
        type: 'turn-finished',
        success: false,
        error: stderrChunks.join('').trim() || `codex exited with code ${code}`
      })
      turnActive = false
    }
    emit({ type: 'process-exited', code })
  })

  const startTurn = (text: string): void => {
    if (!threadId) {
      pendingPrompts.push(text)
      return
    }
    turnActive = true
    const params: Record<string, unknown> = {
      threadId,
      input: [{ type: 'text', text }],
      approvalPolicy: perms.approvalPolicy,
      approvalsReviewer: perms.approvalsReviewer,
      sandboxPolicy: sandboxPolicy(perms.sandbox)
    }
    if (model) params.model = model
    request('turn/start', params)
  }

  return {
    prompt(text: string): void {
      startTurn(text)
    },
    steer(text: string): void {
      if (!threadId || !turnId) {
        pendingPrompts.push(text)
        return
      }
      request('turn/steer', {
        threadId,
        expectedTurnId: turnId,
        input: [{ type: 'text', text }]
      })
    },
    supportsSteer(): boolean {
      return true
    },
    cancel(): void {
      if (!threadId || !turnId) return
      request('turn/interrupt', { threadId, turnId })
    },
    respond(requestId: string, optionId: 'allow' | 'deny'): void {
      const decision =
        optionId === 'allow' ? 'accept' : optionId === 'deny' ? 'decline' : 'decline'
      // Server-originated JSON-RPC request id may be number or string.
      const id = /^\d+$/.test(requestId) ? Number(requestId) : requestId
      proc.writeLine({ id, result: { decision } })
    },
    applyOptions(opts): boolean {
      // Model rides on turn/start; approval needs restart.
      if (opts.approvalMode) return false
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      disposeStdioProcess(proc)
    }
  }
}

function codexItemToolName(itemType: string, item: Record<string, unknown>): string {
  if (itemType === 'commandExecution' || itemType === 'command') return 'Bash'
  if (itemType === 'fileChange' || itemType === 'patch') return 'ApplyPatch'
  if (itemType === 'webSearch') return 'WebSearch'
  if (
    itemType === 'todoList' ||
    itemType === 'todo' ||
    itemType === 'plan' ||
    itemType === 'updatePlan' ||
    itemType === 'update_plan'
  ) {
    return 'update_plan'
  }
  if (itemType === 'proposedPlan' || itemType === 'proposed_plan') return 'proposed_plan'
  if (itemType === 'question' || itemType === 'askUserQuestion') return 'AskUserQuestion'
  return asString(item.name) || itemType
}

/** Live stream only — skip windows without a numeric used_percent. */
function quotaWindowsFromCodexRateLimits(rateLimits: Record<string, unknown>): QuotaWindow[] {
  const now = Date.now()
  const parsed = (['primary', 'secondary'] as const).map((key) => {
    const rec = asRecord(rateLimits[key])
    if (!rec) return { key, rec: null, pct: null, minutes: null }
    const pct = normalizeQuotaPercent(
      num(rec.used_percent) ?? num(rec.usedPercent) ?? num(rec.used_percentage) ?? -1
    )
    return { key, rec, pct, minutes: pct == null ? null : codexWindowMinutesFromRecord(rec) }
  })
  const kinds = classifyCodexRateLimitWindowKinds({
    primary: parsed[0].pct != null ? { minutes: parsed[0].minutes } : null,
    secondary: parsed[1].pct != null ? { minutes: parsed[1].minutes } : null
  })
  const out: QuotaWindow[] = []
  for (const row of parsed) {
    if (!row.rec || row.pct == null) continue
    const kind = kinds[row.key]
    if (!kind) continue
    const resetsIn = num(row.rec.resets_in_seconds) ?? num(row.rec.resetsInSeconds)
    const resetsAt =
      parseQuotaResetsAt(row.rec.resets_at ?? row.rec.resetsAt ?? row.rec.reset_at) ??
      (typeof resetsIn === 'number' && resetsIn >= 0 ? now + Math.round(resetsIn * 1000) : null)
    out.push({
      id: kind === 'other' ? row.key : kind,
      kind,
      usedPercent: row.pct,
      resetsAt,
      updatedAt: now
    })
  }
  return out
}

// silence unused in case turn item arrays appear
void asArray
