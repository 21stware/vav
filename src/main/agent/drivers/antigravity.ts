import type { ApprovalMode } from '@shared/types'
import {
  asRecord,
  asString,
  dig,
  onJsonLines,
  spawnStdioProcess,
  type StdioProcess
} from './process'
import type { DriverControl, DriverEventSink, DriverStartOptions } from './types'

/**
 * Google Antigravity CLI (`agy`) — one-shot print mode with stream-json.
 *
 * Launch: `agy --print=<prompt> --output-format=stream-json [--conversation=ID] …`
 * Each turn is a new process; resume via `--conversation` (conversation_id from init/result).
 * There is no mid-turn stdin steer / interrupt channel — cancel kills the process.
 */
export async function startAntigravityDriver(
  options: DriverStartOptions,
  emit: DriverEventSink
): Promise<DriverControl> {
  let disposed = false
  let conversationId: string | null =
    options.cursor?.provider === 'antigravity' ? options.cursor.conversationId : null
  let active: StdioProcess | null = null
  let turnActive = false
  const pendingPrompts: string[] = []
  let busy = false

  if (conversationId) {
    emit({
      type: 'connected',
      cursor: { provider: 'antigravity', conversationId }
    })
  }

  const runTurn = (text: string): void => {
    if (disposed) return
    if (busy) {
      pendingPrompts.push(text)
      return
    }
    busy = true
    turnActive = true
    emit({ type: 'turn-started' })

    const args = [
      `--print=${text}`,
      '--output-format=stream-json',
      ...printPermissionArgs(options.approvalMode)
    ]
    if (conversationId) args.push(`--conversation=${conversationId}`)
    if (options.model) args.push(`--model=${options.model}`)

    const proc = spawnStdioProcess(
      options.binary,
      args,
      options.cwd,
      options.env,
      options.hostProcess
    )
    active = proc
    const stderrChunks: string[] = []
    proc.child.stderr.on('data', (buf: Buffer) => {
      stderrChunks.push(buf.toString('utf8'))
      if (stderrChunks.length > 40) stderrChunks.shift()
    })

    // Tool ids are stable per step_index within a turn.
    const toolIds = new Map<number, string>()

    onJsonLines(proc.child.stdout, (value) => {
      const finished = handleAntigravityEvent(value, emit, {
        getConversationId: () => conversationId,
        setConversationId: (id) => {
          conversationId = id
          emit({
            type: 'connected',
            cursor: { provider: 'antigravity', conversationId: id }
          })
        },
        toolIds
      })
      if (finished) turnActive = false
    })

    proc.child.on('exit', (code) => {
      if (active === proc) active = null
      busy = false
      if (turnActive) {
        turnActive = false
        const err =
          stderrChunks.join('').trim() ||
          (code ? `agy exited with code ${code}` : 'agy exited before result')
        emit({ type: 'turn-finished', success: false, error: err })
      }
      const next = pendingPrompts.shift()
      if (next && !disposed) runTurn(next)
    })
  }

  return {
    prompt(text: string): void {
      runTurn(text)
    },
    supportsSteer(): boolean {
      return false
    },
    cancel(): void {
      active?.kill()
      active = null
    },
    respond(): void {
      // Print mode with --dangerously-skip-permissions never asks.
    },
    applyOptions(opts): boolean {
      // Model / permission are launch flags — restart for next turn.
      if (opts.approvalMode && opts.approvalMode !== options.approvalMode) return false
      if (opts.model !== undefined) {
        options.model = opts.model
        return true
      }
      return true
    },
    dispose(): void {
      disposed = true
      pendingPrompts.length = 0
      active?.kill()
      active = null
    }
  }
}

function printPermissionArgs(mode: ApprovalMode): string[] {
  // Antigravity has no interactive permission stream in print mode.
  if (mode === 'bypass' || mode === 'auto' || mode === 'edit') {
    return ['--dangerously-skip-permissions']
  }
  return ['--dangerously-skip-permissions']
}

/** Returns true when the turn is settled (result event). */
function handleAntigravityEvent(
  value: unknown,
  emit: DriverEventSink,
  ctx: {
    getConversationId: () => string | null
    setConversationId: (id: string) => void
    toolIds: Map<number, string>
  }
): boolean {
  const msg = asRecord(value)
  if (!msg) return false
  const event = asString(msg.event)

  if (event === 'init') {
    const id =
      asString(msg.conversation_id) ||
      asString(dig(msg, 'init.conversation_id')) ||
      asString(dig(msg, 'conversationId'))
    if (id && id !== ctx.getConversationId()) ctx.setConversationId(id)
    return false
  }

  if (event === 'step_update') {
    const step = asRecord(msg.step_update) ?? {}
    const stepType = asString(step.step_type)
    const state = asString(step.state) || ''
    const stepIndex = typeof step.step_index === 'number' ? step.step_index : -1

    if (stepType === 'agent_response') {
      const delta = asString(step.text_delta)
      if (delta) emit({ type: 'text-delta', text: delta })
      const usage = asRecord(step.usage)
      if (usage && state === 'DONE') {
        emit({
          type: 'usage',
          inputTokens: num(usage.input_tokens),
          outputTokens: num(usage.output_tokens),
          cacheRead: num(usage.cache_read_tokens)
        })
      }
      return false
    }

    if (stepType === 'tool') {
      const name = asString(step.tool_name) || asString(dig(step, 'tool_info.name')) || 'tool'
      const info = asRecord(step.tool_info) ?? {}
      const params = info.parameters ?? info.input ?? {}
      let id = ctx.toolIds.get(stepIndex)
      if (!id) {
        id = `agy-tool-${stepIndex}`
        ctx.toolIds.set(stepIndex, id)
      }
      if (state === 'ACTIVE') {
        emit({ type: 'tool', id, name, input: params, status: 'started' })
      } else if (state === 'DONE') {
        emit({
          type: 'tool',
          id,
          name,
          input: params,
          status: 'completed',
          output: asString(info.output) ?? undefined
        })
      } else if (state === 'ERROR') {
        const err =
          asString(dig(info, 'error.message')) || asString(info.error) || 'Tool error'
        emit({ type: 'tool', id, name, input: params, status: 'error', output: err })
      }
      return false
    }
    return false
  }

  if (event === 'result') {
    const result = asRecord(msg.result) ?? {}
    const id =
      asString(result.conversation_id) ||
      asString(msg.conversation_id) ||
      ctx.getConversationId()
    if (id && id !== ctx.getConversationId()) ctx.setConversationId(id)
    const status = asString(result.status)
    const ok = status === 'SUCCESS' || status === 'success' || !status
    const usage = asRecord(result.usage)
    if (usage) {
      emit({
        type: 'usage',
        inputTokens: num(usage.input_tokens),
        outputTokens: num(usage.output_tokens),
        cacheRead: num(usage.cache_read_tokens)
      })
    }
    emit({
      type: 'turn-finished',
      success: ok,
      error: ok
        ? undefined
        : asString(result.error) || asString(result.response) || 'Antigravity turn failed'
    })
    return true
  }
  return false
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
