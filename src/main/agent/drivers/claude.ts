import { randomUUID } from 'node:crypto'
import type { ApprovalMode, QuotaWindow } from '@shared/types'
import {
  normalizeQuotaPercent,
  normalizeQuotaResetsAt,
  quotaKindFromClaudeType
} from '@shared/tokenUsage'
import { ensureClaudeWorkspaceTrusted } from '../../terminal/claudeTrust'
import {
  asArray,
  asRecord,
  asString,
  dig,
  onJsonLines,
  spawnStdioProcess,
  type StdioProcess
} from './process'
import type { DriverControl, DriverEventSink, DriverStartOptions } from './types'

function permissionMode(approval: ApprovalMode): string {
  switch (approval) {
    case 'bypass':
      return 'bypassPermissions'
    case 'auto':
      return 'acceptEdits'
    case 'edit':
    default:
      return 'default'
  }
}

/**
 * Claude Code streaming-input session (same wire protocol as the Agent SDK).
 *
 * Launch: `claude -p --input-format stream-json --output-format stream-json …`
 * Permissions: undocumented `--permission-prompt-tool stdio` → control_request.
 * Steer: plain user message while a turn is active (folded into the same turn).
 * Cancel: control_request subtype interrupt.
 */
export async function startClaudeDriver(
  options: DriverStartOptions,
  emit: DriverEventSink
): Promise<DriverControl> {
  const sessionId =
    options.cursor?.provider === 'claude' && options.cursor.sessionId
      ? options.cursor.sessionId
      : randomUUID()
  const resuming = options.cursor?.provider === 'claude' && !!options.cursor.sessionId

  try {
    ensureClaudeWorkspaceTrusted(options.cwd)
  } catch {
    /* trust file write is best-effort */
  }

  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--replay-user-messages',
    '--permission-prompt-tool',
    'stdio',
    '--permission-mode',
    permissionMode(options.approvalMode)
  ]
  if (options.approvalMode === 'bypass') {
    args.push('--dangerously-skip-permissions')
  }
  if (options.model) {
    args.push('--model', options.model)
  }
  if (resuming) {
    args.push('--resume', sessionId)
  } else {
    args.push('--session-id', sessionId)
  }

  const proc = spawnStdioProcess(options.binary, args, options.cwd, options.env)
  return wireClaude(proc, sessionId, options.approvalMode === 'bypass' || options.approvalMode === 'auto', emit)
}

function wireClaude(
  proc: StdioProcess,
  sessionId: string,
  autoApprove: boolean,
  emit: DriverEventSink
): DriverControl {
  let disposed = false
  let turnActive = false
  let sawTextDelta = false
  let sawReasoningDelta = false
  let controlSeq = 0
  const stderrChunks: string[] = []

  emit({
    type: 'connected',
    cursor: { provider: 'claude', sessionId, resumeAt: null }
  })

  proc.child.stderr.on('data', (buf: Buffer) => {
    const text = buf.toString('utf8')
    stderrChunks.push(text)
    if (stderrChunks.length > 40) stderrChunks.shift()
  })

  onJsonLines(proc.child.stdout, (value) => {
    handleClaudeMessage(value, {
      emit,
      autoApprove,
      write: (obj) => proc.writeLine(obj),
      get turnActive() {
        return turnActive
      },
      setTurnActive(v: boolean) {
        turnActive = v
      },
      get sawTextDelta() {
        return sawTextDelta
      },
      setSawTextDelta(v: boolean) {
        sawTextDelta = v
      },
      get sawReasoningDelta() {
        return sawReasoningDelta
      },
      setSawReasoningDelta(v: boolean) {
        sawReasoningDelta = v
      },
      resetDeltas() {
        sawTextDelta = false
        sawReasoningDelta = false
      }
    })
  })

  proc.child.on('exit', (code) => {
    if (disposed) return
    if (turnActive) {
      const err =
        code && code !== 0
          ? stderrChunks.join('').trim() || `claude exited with code ${code}`
          : undefined
      emit({ type: 'turn-finished', success: !code, error: err })
      turnActive = false
    }
    emit({ type: 'process-exited', code })
  })

  const writeUser = (text: string): void => {
    proc.writeLine({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text }]
      },
      parent_tool_use_id: null
    })
  }

  const writeControl = (subtype: string, extra: Record<string, unknown> = {}): string => {
    controlSeq += 1
    const requestId = `vav-${controlSeq}`
    proc.writeLine({
      type: 'control_request',
      request_id: requestId,
      request: { subtype, ...extra }
    })
    return requestId
  }

  return {
    prompt(text: string): void {
      turnActive = true
      sawTextDelta = false
      sawReasoningDelta = false
      emit({ type: 'turn-started' })
      writeUser(text)
    },
    steer(text: string): void {
      writeUser(text)
    },
    supportsSteer(): boolean {
      return true
    },
    cancel(): void {
      writeControl('interrupt')
    },
    respond(requestId: string, optionId: 'allow' | 'deny', message?: string): void {
      const result =
        optionId === 'allow'
          ? { behavior: 'allow' }
          : { behavior: 'deny', message: message || 'Denied by user' }
      proc.writeLine({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: result
        }
      })
    },
    applyOptions(opts): boolean {
      if (opts.model) {
        writeControl('set_model', { model: opts.model })
        return true
      }
      // Permission posture is a launch flag — restart required.
      if (opts.approvalMode) return false
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      proc.closeStdin()
      // Fallback if the CLI ignores stdin EOF.
      setTimeout(() => proc.kill(), 2_000)
    }
  }
}

interface ClaudeHandlerCtx {
  emit: DriverEventSink
  autoApprove: boolean
  write: (obj: unknown) => void
  turnActive: boolean
  setTurnActive(v: boolean): void
  sawTextDelta: boolean
  setSawTextDelta(v: boolean): void
  sawReasoningDelta: boolean
  setSawReasoningDelta(v: boolean): void
  resetDeltas(): void
}

function handleClaudeMessage(value: unknown, ctx: ClaudeHandlerCtx): void {
  const msg = asRecord(value)
  if (!msg) return
  const type = asString(msg.type)

  if (type === 'control_request') {
    const request = asRecord(msg.request)
    if (asString(request?.subtype) !== 'can_use_tool') return
    const requestId = asString(msg.request_id) || asString(dig(msg, 'request.request_id'))
    if (!requestId) return
    const toolName = asString(request?.tool_name) || asString(request?.toolName) || 'tool'
    const input = request?.input
    const summary =
      asString(request?.blocked_path) ||
      asString(dig(request, 'permission_suggestions.0')) ||
      toolName
    if (ctx.autoApprove) {
      ctx.write({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: { behavior: 'allow' }
        }
      })
      return
    }
    ctx.emit({
      type: 'permission',
      requestId,
      toolName,
      summary: String(summary),
      detail: asString(request?.description) ?? undefined,
      input
    })
    return
  }

  if (type === 'rate_limit_event') {
    const windows = quotaWindowsFromClaudeMessage(msg)
    if (windows.length) ctx.emit({ type: 'quota', windows })
    return
  }

  if (type === 'stream_event') {
    if (asString(msg.parent_tool_use_id)) return
    const event = asRecord(msg.event) ?? {}
    if (asString(event.type) === 'message_start') ctx.resetDeltas()
    const delta = asRecord(event.delta) ?? {}
    const deltaType = asString(delta.type)
    if (deltaType === 'text_delta') {
      const text = asString(delta.text)
      if (text) {
        ctx.setSawTextDelta(true)
        ctx.emit({ type: 'text-delta', text })
      }
    } else if (deltaType === 'thinking_delta') {
      const text = asString(delta.thinking)
      if (text) {
        ctx.setSawReasoningDelta(true)
        ctx.emit({ type: 'reasoning-delta', text })
      }
    }
    return
  }

  if (type === 'assistant') {
    if (asString(msg.parent_tool_use_id)) return
    const usage = dig(msg, 'message.usage')
    if (usage) {
      const u = asRecord(usage)
      ctx.emit({
        type: 'usage',
        inputTokens: num(u?.input_tokens) ?? num(u?.inputTokens),
        outputTokens: num(u?.output_tokens) ?? num(u?.outputTokens),
        cacheRead: num(u?.cache_read_input_tokens) ?? num(u?.cacheReadInputTokens),
        cacheWrite: num(u?.cache_creation_input_tokens) ?? num(u?.cacheCreationInputTokens)
      })
    }
    const content = asArray(dig(msg, 'message.content')) ?? []
    for (const block of content) {
      const b = asRecord(block)
      if (!b) continue
      const bType = asString(b.type)
      if (bType === 'text' && !ctx.sawTextDelta) {
        const text = asString(b.text)
        if (text) ctx.emit({ type: 'text-delta', text })
      } else if (bType === 'thinking' && !ctx.sawReasoningDelta) {
        const text = asString(b.thinking)
        if (text) ctx.emit({ type: 'reasoning-delta', text })
      } else if (bType === 'tool_use') {
        const id = asString(b.id) || randomUUID()
        const name = asString(b.name) || 'tool'
        ctx.emit({
          type: 'tool',
          id,
          name,
          input: b.input ?? {},
          status: 'started'
        })
      }
    }
    return
  }

  if (type === 'user') {
    if (asString(msg.parent_tool_use_id)) return
    if (msg.isReplay === true) return
    const content = asArray(dig(msg, 'message.content')) ?? []
    for (const block of content) {
      const b = asRecord(block)
      if (!b) continue
      if (asString(b.type) !== 'tool_result') continue
      const id = asString(b.tool_use_id) || asString(b.toolUseId) || ''
      if (!id) continue
      const isError = b.is_error === true || b.isError === true
      const output = toolResultText(b.content)
      ctx.emit({
        type: 'tool',
        id,
        name: 'tool',
        input: {},
        status: isError ? 'error' : 'completed',
        output
      })
    }
    return
  }

  if (type === 'result') {
    const isError =
      msg.is_error === true ||
      msg.isError === true ||
      typeof msg.api_error_status === 'number' ||
      asString(msg.terminal_reason) === 'api_error' ||
      asString(msg.subtype) === 'error'
    const error = isError
      ? asString(msg.result) || asString(msg.error) || 'Claude turn failed'
      : undefined
    // Latest assistant uuid is a rewind checkpoint when present.
    const resumeAt =
      asString(msg.uuid) ||
      asString(msg.session_id) ||
      asString(dig(msg, 'sessionId')) ||
      null
    ctx.setTurnActive(false)
    ctx.emit({
      type: 'turn-finished',
      success: !isError,
      error: error ?? undefined,
      resumeAt
    })
    const usage = asRecord(msg.usage)
    if (usage) {
      ctx.emit({
        type: 'usage',
        inputTokens: num(usage.input_tokens) ?? num(usage.inputTokens),
        outputTokens: num(usage.output_tokens) ?? num(usage.outputTokens),
        cacheRead: num(usage.cache_read_input_tokens),
        cacheWrite: num(usage.cache_creation_input_tokens)
      })
    }
  }
}

/**
 * Live stream only: keep windows that include a numeric utilization /
 * used_percentage. Status-only rate_limit_event rows are ignored.
 */
function quotaWindowsFromClaudeMessage(msg: Record<string, unknown>): QuotaWindow[] {
  const now = Date.now()
  const out: QuotaWindow[] = []

  const info = asRecord(msg.rate_limit_info) ?? asRecord(msg.rateLimitInfo)
  if (info) {
    const window = windowFromClaudeInfo(info, now)
    if (window) out.push(window)
  }

  const nested =
    asRecord(msg.rate_limits) ??
    asRecord(msg.rateLimits) ??
    asRecord(dig(info, 'rate_limits')) ??
    asRecord(dig(info, 'rateLimits'))
  if (nested) {
    for (const [key, value] of Object.entries(nested)) {
      const rec = asRecord(value)
      if (!rec) continue
      const kind = quotaKindFromClaudeType(key)
      const pct =
        normalizeQuotaPercent(num(rec.used_percentage) ?? num(rec.usedPercentage) ?? -1) ??
        normalizeQuotaPercent(num(rec.utilization) ?? -1)
      if (pct == null) continue
      out.push({
        id: kind === 'other' ? key : kind,
        kind,
        usedPercent: pct,
        resetsAt: normalizeQuotaResetsAt(
          num(rec.resets_at) ?? num(rec.resetsAt) ?? num(rec.reset_at)
        ),
        updatedAt: now
      })
    }
  }

  return out
}

function windowFromClaudeInfo(
  info: Record<string, unknown>,
  now: number
): QuotaWindow | null {
  const pct =
    normalizeQuotaPercent(num(info.utilization) ?? -1) ??
    normalizeQuotaPercent(num(info.used_percentage) ?? num(info.usedPercentage) ?? -1)
  if (pct == null) return null
  const type =
    asString(info.rateLimitType) ||
    asString(info.rate_limit_type) ||
    asString(info.type) ||
    'other'
  const kind = quotaKindFromClaudeType(type)
  return {
    id: kind === 'other' ? type : kind,
    kind,
    usedPercent: pct,
    resetsAt: normalizeQuotaResetsAt(
      num(info.resetsAt) ?? num(info.resets_at) ?? num(info.reset_at)
    ),
    updatedAt: now
  }
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  const arr = asArray(content)
  if (!arr) {
    try {
      return JSON.stringify(content ?? '')
    } catch {
      return String(content ?? '')
    }
  }
  const parts: string[] = []
  for (const item of arr) {
    if (typeof item === 'string') {
      parts.push(item)
      continue
    }
    const rec = asRecord(item)
    if (!rec) continue
    if (asString(rec.type) === 'text' && asString(rec.text)) parts.push(asString(rec.text)!)
    else if (asString(rec.text)) parts.push(asString(rec.text)!)
  }
  return parts.join('\n')
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
