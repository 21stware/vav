#!/usr/bin/env node
/**
 * Local ACP v1 stdio fixture for Playwright. Ignores vendor argv (`acp`, …).
 * Speaks JSON-RPC lines on stdin/stdout — no network, no vendor CLI.
 */
import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = 1

/** @typedef {Record<string, unknown>} Rpc */

let nextSession = 1
/** @type {Map<string, { modeId: string }>} */
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
        : `e2e-acp-${nextSession++}`
    sessions.set(sessionId, { modeId: 'agent' })
    result(id, {
      sessionId,
      title: 'E2E ACP',
      modes,
      availableCommands,
      configOptions
    })
    return
  }

  if (method === 'session/prompt') {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
    sessionUpdate(sessionId, {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'e2e acp thought' }
    })
    sessionUpdate(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'e2e acp reply' }
    })
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

  if (method === 'session/cancel' || method === 'session/close' || method === 'session/set_model') {
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
