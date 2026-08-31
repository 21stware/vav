#!/usr/bin/env node
/**
 * Local ACP v1 stdio fixture for Playwright. Ignores vendor argv (`acp`, …).
 * Speaks JSON-RPC lines on stdin/stdout — no network, no vendor CLI.
 *
 * Env knobs:
 * - E2E_ACP_USAGE=1 — emit usage_update / turn_completed usage on prompts.
 * - E2E_ACP_FAIL_PROMPTS=<n> — fail the first n session/prompt calls
 *   (across restarts, tracked in E2E_ACP_FAIL_STATE file) with a
 *   network-flavored JSON-RPC error, then succeed.
 * - E2E_ACP_PLAN=1 — replay the cursor-agent createPlan contract on the
 *   first prompt: hold `session/prompt` open, issue a blocking
 *   `cursor/create_plan` request, and only end the turn (stopReason
 *   end_turn, no further work) once the client responds. Later prompts
 *   reply "e2e implementing plan". Mirrors the wire capture from
 *   cursor-agent 2026.08.25.
 * - E2E_ACP_LEAK_PROMPTS=<n> — the first n prompts stream ONLY the leaked
 *   cursor-agent internal error ("Error: RetriableError: WritableIterable
 *   is closed") as agent_message_chunk and still end with end_turn.
 * - E2E_ACP_LEAK_TAIL=1 — every prompt appends the leaked error as a
 *   trailing chunk after the real reply, then ends with end_turn.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = 1

const EMIT_USAGE = process.env.E2E_ACP_USAGE === '1'
const FAIL_PROMPTS = Number(process.env.E2E_ACP_FAIL_PROMPTS ?? 0) || 0
const FAIL_STATE = process.env.E2E_ACP_FAIL_STATE || ''
const PLAN_MODE = process.env.E2E_ACP_PLAN === '1'
const MODEL_LOG = process.env.E2E_ACP_MODEL_LOG || ''
const LEAK_PROMPTS = Number(process.env.E2E_ACP_LEAK_PROMPTS ?? 0) || 0
const LEAK_TAIL = process.env.E2E_ACP_LEAK_TAIL === '1'

/** cursor-agent ACP bug: internal stream teardown leaks as assistant text. */
const LEAKED_STREAM_ERROR = 'Error: RetriableError: WritableIterable is closed'
let leakedPrompts = 0

const PLAN_REQUEST_ID = 9001
const PLAN_TOOL_CALL_ID = 'e2e-plan-tool'
/** session/prompt id held open while cursor/create_plan awaits its answer. */
let heldPlanPrompt = null
let planRequestSent = false

function failedSoFar() {
  if (!FAIL_STATE) return 0
  try {
    if (!existsSync(FAIL_STATE)) return 0
    return Number(readFileSync(FAIL_STATE, 'utf8').trim()) || 0
  } catch {
    return 0
  }
}

function recordFailure(count) {
  if (!FAIL_STATE) return
  try {
    writeFileSync(FAIL_STATE, String(count))
  } catch {
    // ignore
  }
}

/** @typedef {Record<string, unknown>} Rpc */

const instanceId = `${process.pid}-${Math.random().toString(16).slice(2, 8)}`
let nextSession = 1
let promptTurns = 0
/** @type {Map<string, { modeId: string, modelId: string }>} */
const sessions = new Map()

const modes = {
  currentModeId: 'agent',
  availableModes: [
    { id: 'agent', name: 'Agent', description: 'Full edit' },
    { id: 'plan', name: 'Plan', description: 'Read-only plan' }
  ]
}

const configOptions = [
  {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    type: 'select',
    currentValue: 'agent',
    options: [
      { value: 'agent', name: 'Agent' },
      { value: 'plan', name: 'Plan' }
    ]
  }
]

const availableCommands = [
  { name: 'compact', description: 'Compact this session' },
  { name: 'cost', description: 'Show session cost' }
]

// Cursor-agent shape: the context window is only advertised inline on the
// model id — no usage ever crosses the wire.
const models = {
  currentModelId: 'e2e-model[thinking=true,context=123k,effort=high]',
  availableModels: [
    { modelId: 'default[]', name: 'Auto' },
    { modelId: 'grok-4.6[effort=high,fast=true]', name: 'grok-4.6' },
    {
      modelId: 'claude-fable-5[thinking=true,context=300k,effort=high]',
      name: 'claude-fable-5'
    },
    { modelId: 'e2e-model[thinking=true,context=123k,effort=high]', name: 'e2e-model' },
    { modelId: 'other-model[effort=low]', name: 'other-model' }
  ]
}

if (process.argv.includes('--list-models')) {
  process.stdout.write(
    [
      'Available models',
      '',
      'auto - Auto (default)',
      'cursor-grok-4.6-high-fast - Cursor Grok 4.6 Fast',
      'cursor-grok-4.6-low - Cursor Grok 4.6 Low',
      'claude-fable-5-thinking-high - Claude Fable 5 1M Thinking (NO ZDR)',
      'composer-2.5 - Composer 2.5',
      ''
    ].join('\n')
  )
  process.exit(0)
}

function isPickerAlias(modelId) {
  const id = String(modelId ?? '').trim()
  if (!id || id.includes('[')) return false
  if (id.startsWith('cursor-')) return true
  return /-(?:thinking-)?(?:low|medium|high|xhigh|max)(?:-fast)?$/.test(id) || /-(?:fast)$/.test(id)
}

function logModel(sessionId, modelId, ok) {
  if (!MODEL_LOG) return
  try {
    appendFileSync(
      MODEL_LOG,
      `${JSON.stringify({ sessionId, modelId, ok, at: Date.now() })}\n`
    )
  } catch {
    // ignore
  }
}

function write(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

function result(id, value) {
  write({ jsonrpc: '2.0', id, result: value ?? {} })
}

function notify(method, params) {
  write({ jsonrpc: '2.0', method, params })
}

function sessionUpdate(sessionId, update) {
  notify('session/update', { sessionId, update, sessionUpdate: update.sessionUpdate })
}

function handle(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return
  const method = typeof msg.method === 'string' ? msg.method : ''
  const id = msg.id

  // Client → agent JSON-RPC responses (no method). The only request this
  // fixture sends is cursor/create_plan; once answered, finish the plan
  // tool and end the held turn — exactly what cursor-agent does: it does
  // NOT continue implementing, the client must send the follow-up prompt.
  if (!method) {
    if (id === PLAN_REQUEST_ID && heldPlanPrompt) {
      const { promptId, sessionId } = heldPlanPrompt
      heldPlanPrompt = null
      sessionUpdate(sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId: PLAN_TOOL_CALL_ID,
        status: 'completed'
      })
      result(promptId, { stopReason: 'end_turn' })
    }
    return
  }

  const params = msg.params && typeof msg.params === 'object' ? msg.params : {}

  if (method === 'initialize') {
    result(id, {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, embeddedContext: true }
      },
      authMethods: []
    })
    return
  }

  if (method === 'session/new' || method === 'session/load' || method === 'session/resume') {
    const sessionId =
      typeof params.sessionId === 'string' && params.sessionId
        ? params.sessionId
        : `e2e-acp-${instanceId}-${nextSession++}`
    const requested =
      typeof params.modelId === 'string' && params.modelId ? params.modelId : models.currentModelId
    sessions.set(sessionId, { modeId: 'agent', modelId: requested })
    result(id, {
      sessionId,
      title: 'E2E ACP',
      modes,
      models,
      availableCommands,
      configOptions
    })
    return
  }

  if (method === 'session/prompt') {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
    const failed = failedSoFar()
    if (FAIL_PROMPTS > 0 && failed < FAIL_PROMPTS) {
      recordFailure(failed + 1)
      write({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message:
            'RetriableError: [aborted] Client network socket disconnected before secure TLS connection was established'
        }
      })
      return
    }
    promptTurns += 1
    if (PLAN_MODE && !planRequestSent) {
      planRequestSent = true
      heldPlanPrompt = { promptId: id, sessionId }
      sessionUpdate(sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId: PLAN_TOOL_CALL_ID,
        title: 'Create Plan',
        kind: 'other',
        status: 'pending',
        rawInput: { _toolName: 'createPlan' }
      })
      write({
        jsonrpc: '2.0',
        id: PLAN_REQUEST_ID,
        method: 'cursor/create_plan',
        params: {
          toolCallId: PLAN_TOOL_CALL_ID,
          name: 'E2E Plan',
          overview: 'Create hello.txt containing hi.',
          plan: '# E2E Plan\n\nCreate `hello.txt` containing `hi`.',
          todos: [{ id: 'e2e-todo', content: 'Create hello.txt', status: 'pending' }],
          isProject: false,
          phases: []
        }
      })
      // Turn stays open until the client answers cursor/create_plan.
      return
    }
    if (PLAN_MODE && planRequestSent) {
      sessionUpdate(sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'e2e implementing plan' }
      })
      result(id, { stopReason: 'end_turn' })
      return
    }
    if (LEAK_PROMPTS > 0 && leakedPrompts < LEAK_PROMPTS) {
      leakedPrompts += 1
      // The whole "reply" is the leaked internal error — the client must
      // treat the turn as failed and retry, not seal the error text.
      sessionUpdate(sessionId, {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'e2e acp thought' }
      })
      sessionUpdate(sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: LEAKED_STREAM_ERROR }
      })
      result(id, { stopReason: 'end_turn' })
      return
    }
    sessionUpdate(sessionId, {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'e2e acp thought' }
    })
    sessionUpdate(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'e2e acp reply' }
    })
    if (LEAK_TAIL) {
      // Real reply completed; the teardown error trails it before end_turn.
      sessionUpdate(sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `\n\n${LEAKED_STREAM_ERROR}` }
      })
    }
    if (EMIT_USAGE) {
      // Grok-style mid-turn context fill, then a turn_completed usage record.
      sessionUpdate(sessionId, {
        sessionUpdate: 'usage_update',
        used: 12_000 * promptTurns,
        size: 240_000
      })
      sessionUpdate(sessionId, {
        sessionUpdate: 'turn_completed',
        usage: {
          inputTokens: 9_000 * promptTurns,
          outputTokens: 500,
          cacheRead: 3_000 * promptTurns,
          cacheWrite: 0
        }
      })
    }
    result(id, { stopReason: 'end_turn' })
    return
  }

  if (method === 'session/set_mode') {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
    const modeId = typeof params.modeId === 'string' ? params.modeId : 'agent'
    const session = sessions.get(sessionId)
    if (session) session.modeId = modeId
    configOptions[0].currentValue = modeId
    modes.currentModeId = modeId
    sessionUpdate(sessionId, { sessionUpdate: 'current_mode_update', modeId })
    result(id, { currentModeId: modeId })
    return
  }

  if (method === 'session/set_config_option') {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
    const configId = typeof params.configId === 'string' ? params.configId : ''
    const value = params.value
    const option = configOptions.find((row) => row.id === configId)
    if (option) option.currentValue = value
    if (configId === 'mode' && typeof value === 'string') {
      modes.currentModeId = value
      const session = sessions.get(sessionId)
      if (session) session.modeId = value
      sessionUpdate(sessionId, { sessionUpdate: 'current_mode_update', modeId: value })
    }
    result(id, { configOptions })
    return
  }

  if (method === 'session/set_model') {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
    const modelId = typeof params.modelId === 'string' ? params.modelId : ''
    if (isPickerAlias(modelId)) {
      logModel(sessionId, modelId, false)
      write({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32602,
          message: 'Invalid params',
          data: { message: `Invalid model value: ${modelId}` }
        }
      })
      return
    }
    const session = sessions.get(sessionId)
    if (session) session.modelId = modelId
    models.currentModelId = modelId || models.currentModelId
    logModel(sessionId, modelId, true)
    if (id !== undefined) result(id, {})
    return
  }

  if (method === 'session/cancel' || method === 'session/close') {
    if (id !== undefined) result(id, {})
    return
  }

  if (id !== undefined) {
    write({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    })
  }
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    handle(JSON.parse(trimmed))
  } catch {
    // ignore malformed lines
  }
})
rl.on('close', () => process.exit(0))
