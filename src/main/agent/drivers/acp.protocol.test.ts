import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, it } from 'node:test'
import { ACP_CLIENT_CAPABILITIES, ACP_PROTOCOL_VERSION } from '../../../shared/acpSession.ts'
import { RpcErrorCode } from '../../../shared/cliErrors.ts'
import { acpInvokeArgs, wireAcp } from './acp.ts'
import type { AcpFileAccess } from './acpFs.ts'
import type { DriverEvent } from './types.ts'
import type { StdioProcess } from './stdioJson.ts'

type JsonRpc = Record<string, unknown>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function fakeStdio(): {
  proc: StdioProcess
  outbound: JsonRpc[]
  toClient(value: unknown): void
} {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
  }
  child.stdout = stdout
  child.stderr = stderr
  const outbound: JsonRpc[] = []
  const proc = {
    child,
    writeLine(obj: unknown): void {
      const rec = asRecord(obj)
      if (rec) outbound.push(rec)
    },
    writeRaw(): void {},
    closeStdin(): void {},
    kill(): void {}
  } as unknown as StdioProcess
  return {
    proc,
    outbound,
    toClient(value: unknown): void {
      stdout.write(`${JSON.stringify(value)}\n`)
    }
  }
}

async function waitFor(
  outbound: JsonRpc[],
  pred: (msg: JsonRpc) => boolean,
  timeoutMs = 1_000
): Promise<JsonRpc> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const found = outbound.find(pred)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(
    `timed out waiting for RPC among ${JSON.stringify(outbound.map((m) => m.method ?? m.id))}`
  )
}

function memoryFiles(initial: Record<string, string> = {}): AcpFileAccess {
  const store = new Map(Object.entries(initial))
  return {
    async readTextFile(path) {
      const content = store.get(path)
      return content == null ? { content: '', error: 'missing' } : { content }
    },
    async writeTextFile(path, content) {
      store.set(path, content)
      return { ok: true }
    }
  }
}

describe('wireAcp protocol', () => {
  it('advertises full client capabilities and serves fs / elicitation / unknown methods', async () => {
    const events: DriverEvent[] = []
    const { proc, outbound, toClient } = fakeStdio()
    const dir = await mkdtemp(join(tmpdir(), 'vav-acp-proto-'))
    const readme = join(dir, 'README.md')
    await writeFile(readme, 'line1\nline2\nline3\n', 'utf8')
    const files = memoryFiles({ [readme]: await readFile(readme, 'utf8') })

    const driver = wireAcp(
      'cursor',
      proc,
      {
        binary: 'cursor-agent',
        cwd: dir,
        approvalMode: 'edit',
        files
      },
      (event) => events.push(event)
    )

    const init = await waitFor(outbound, (msg) => msg.method === 'initialize')
    assert.equal(init.params && asRecord(init.params)?.protocolVersion, ACP_PROTOCOL_VERSION)
    assert.deepEqual(asRecord(init.params)?.clientCapabilities, ACP_CLIENT_CAPABILITIES)

    toClient({
      jsonrpc: '2.0',
      id: init.id,
      result: {
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: true, embeddedContext: true },
          auth: { logout: {} }
        },
        authMethods: []
      }
    })

    const created = await waitFor(outbound, (msg) => msg.method === 'session/new')
    toClient({
      jsonrpc: '2.0',
      id: created.id,
      result: {
        sessionId: 'sess-1',
        modes: {
          currentModeId: 'agent',
          availableModes: [
            { id: 'agent', name: 'Agent' },
            { id: 'plan', name: 'Plan' }
          ]
        },
        availableCommands: [{ name: 'tests', description: 'Run tests' }]
      }
    })

    await waitForEvent(events, (event) => event.type === 'connected')
    const session = events.find((event) => event.type === 'session-state')
    assert.ok(session && session.type === 'session-state')
    assert.equal(session.state.currentModeId, 'agent')
    assert.equal(session.state.commands?.[0]?.name, 'tests')

    driver.prompt('hello', { attachments: [readme] })
    const prompt = await waitFor(outbound, (msg) => msg.method === 'session/prompt')
    const promptParams = asRecord(prompt.params)
    const blocks = Array.isArray(promptParams?.prompt) ? promptParams.prompt : []
    assert.equal(asRecord(blocks[0])?.type, 'text')
    assert.equal(asRecord(blocks[1])?.type, 'resource')

    toClient({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hi there' }
        }
      }
    })
    await waitForEvent(events, (event) => event.type === 'text-delta' && event.text === 'hi there')

    toClient({
      jsonrpc: '2.0',
      id: 80,
      method: 'fs/read_text_file',
      params: { path: readme, line: 2, limit: 1 }
    })
    const readResult = await waitFor(outbound, (msg) => msg.id === 80 && msg.result !== undefined)
    assert.deepEqual(readResult.result, { content: 'line2' })

    toClient({
      jsonrpc: '2.0',
      id: 81,
      method: 'elicitation/create',
      params: {
        mode: 'form',
        message: 'Name?',
        requestedSchema: {
          type: 'object',
          properties: { name: { type: 'string', title: 'Name' } },
          required: ['name']
        }
      }
    })
    const elicit = await waitForEvent(
      events,
      (event) => event.type === 'elicitation' && event.kind === 'form'
    )
    driver.respond(elicit.requestId, 'allow', JSON.stringify({ content: { name: 'Ada' } }))
    const elicitResult = await waitFor(outbound, (msg) => msg.id === 81 && msg.result !== undefined)
    assert.deepEqual(elicitResult.result, { action: 'accept', content: { name: 'Ada' } })

    toClient([
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess-1',
          update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'lint' }] }
        }
      },
      { jsonrpc: '2.0', id: 82, method: 'no/such/method', params: {} }
    ])
    await waitForEvent(
      events,
      (event) => event.type === 'session-state' && event.state.commands?.[0]?.name === 'lint'
    )
    const missing = await waitFor(outbound, (msg) => msg.id === 82 && msg.error != null)
    assert.equal(asRecord(missing.error)?.code, RpcErrorCode.methodNotFound)

    toClient({
      jsonrpc: '2.0',
      id: prompt.id,
      result: { stopReason: 'end_turn' }
    })
    await waitForEvent(events, (event) => event.type === 'turn-finished' && event.success === true)

    driver.dispose()
    const closed = await waitFor(outbound, (msg) => msg.method === 'session/close')
    assert.equal(asRecord(closed.params)?.sessionId, 'sess-1')
    assert.ok(closed.id !== undefined)
  })

  it('maps picker model ids onto ACP session/set_model before each prompt', async () => {
    const events: DriverEvent[] = []
    const { proc, outbound, toClient } = fakeStdio()
    const dir = await mkdtemp(join(tmpdir(), 'vav-acp-model-'))

    const driver = wireAcp(
      'cursor',
      proc,
      {
        binary: 'cursor-agent',
        cwd: dir,
        approvalMode: 'edit',
        model: 'cursor-grok-4.6-high-fast'
      },
      (event) => events.push(event)
    )

    const init = await waitFor(outbound, (msg) => msg.method === 'initialize')
    toClient({
      jsonrpc: '2.0',
      id: init.id,
      result: {
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true },
        authMethods: []
      }
    })

    const created = await waitFor(outbound, (msg) => msg.method === 'session/new')
    assert.equal(asRecord(created.params)?.modelId, 'grok-4.6[effort=high,fast=true]')
    toClient({
      jsonrpc: '2.0',
      id: created.id,
      result: {
        sessionId: 'sess-model',
        models: {
          currentModelId: 'default[]',
          availableModels: [
            { modelId: 'default[]', name: 'Auto' },
            { modelId: 'grok-4.6[effort=high,fast=true]', name: 'grok-4.6' },
            {
              modelId: 'claude-fable-5[thinking=true,context=300k,effort=high]',
              name: 'claude-fable-5'
            }
          ]
        }
      }
    })

    const bootSet = await waitForNth(outbound, (msg) => msg.method === 'session/set_model', 1)
    assert.equal(asRecord(bootSet.params)?.modelId, 'grok-4.6[effort=high,fast=true]')
    toClient({ jsonrpc: '2.0', id: bootSet.id, result: {} })
    await waitForEvent(events, (event) => event.type === 'connected')

    driver.applyOptions?.({ model: 'claude-fable-5-thinking-high' })
    const switched = await waitForNth(outbound, (msg) => msg.method === 'session/set_model', 2)
    assert.equal(
      asRecord(switched.params)?.modelId,
      'claude-fable-5[thinking=true,context=300k,effort=high]'
    )
    toClient({ jsonrpc: '2.0', id: switched.id, result: {} })

    driver.prompt('hello')
    const pinned = await waitForNth(outbound, (msg) => msg.method === 'session/set_model', 3)
    assert.equal(
      asRecord(pinned.params)?.modelId,
      'claude-fable-5[thinking=true,context=300k,effort=high]'
    )
    toClient({ jsonrpc: '2.0', id: pinned.id, result: {} })

    const prompt = await waitFor(outbound, (msg) => msg.method === 'session/prompt')
    assert.equal(asRecord(prompt.params)?.sessionId, 'sess-model')
    toClient({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } })
    await waitForEvent(events, (event) => event.type === 'turn-finished' && event.success === true)

    driver.dispose()
  })

  it('applies thinking level and fast from session prefs', async () => {
    const events: DriverEvent[] = []
    const { proc, outbound, toClient } = fakeStdio()
    const dir = await mkdtemp(join(tmpdir(), 'vav-acp-prefs-'))

    const driver = wireAcp(
      'cursor',
      proc,
      {
        binary: 'cursor-agent',
        cwd: dir,
        approvalMode: 'edit',
        model: 'grok-4.6',
        thinkingLevel: 'low',
        fast: true
      },
      (event) => events.push(event)
    )

    const init = await waitFor(outbound, (msg) => msg.method === 'initialize')
    toClient({
      jsonrpc: '2.0',
      id: init.id,
      result: {
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true },
        authMethods: []
      }
    })

    const created = await waitFor(outbound, (msg) => msg.method === 'session/new')
    assert.equal(asRecord(created.params)?.modelId, 'grok-4.6[effort=low,fast=true]')
    toClient({
      jsonrpc: '2.0',
      id: created.id,
      result: {
        sessionId: 'sess-prefs',
        models: {
          currentModelId: 'default[]',
          availableModels: [
            { modelId: 'grok-4.6[effort=high,fast=true]', name: 'grok-4.6' }
          ]
        }
      }
    })

    const set = await waitFor(outbound, (msg) => msg.method === 'session/set_model')
    assert.equal(asRecord(set.params)?.modelId, 'grok-4.6[effort=low,fast=true]')
    toClient({ jsonrpc: '2.0', id: set.id, result: {} })
    await waitForEvent(events, (event) => event.type === 'connected')
    driver.dispose()
  })

  it('retries session/new without modelId when Cursor rejects the field', async () => {
    const events: DriverEvent[] = []
    const { proc, outbound, toClient } = fakeStdio()
    const dir = await mkdtemp(join(tmpdir(), 'vav-acp-new-model-'))

    const driver = wireAcp(
      'cursor',
      proc,
      {
        binary: 'cursor-agent',
        cwd: dir,
        approvalMode: 'edit',
        model: 'grok-4.6',
        thinkingLevel: 'medium',
        fast: false
      },
      (event) => events.push(event)
    )

    const init = await waitFor(outbound, (msg) => msg.method === 'initialize')
    toClient({
      jsonrpc: '2.0',
      id: init.id,
      result: {
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true },
        authMethods: []
      }
    })

    const first = await waitFor(outbound, (msg) => msg.method === 'session/new')
    assert.equal(asRecord(first.params)?.modelId, 'grok-4.6[effort=medium,fast=false]')
    toClient({
      jsonrpc: '2.0',
      id: first.id,
      error: { code: RpcErrorCode.invalidParams, message: 'Invalid params' }
    })

    const retry = await waitForNth(outbound, (msg) => msg.method === 'session/new', 2)
    assert.equal(asRecord(retry.params)?.modelId, undefined)
    toClient({
      jsonrpc: '2.0',
      id: retry.id,
      result: {
        sessionId: 'sess-retry',
        models: {
          currentModelId: 'default[]',
          availableModels: [{ modelId: 'grok-4.6[effort=high,fast=true]', name: 'grok-4.6' }]
        }
      }
    })

    const set = await waitFor(outbound, (msg) => msg.method === 'session/set_model')
    assert.equal(asRecord(set.params)?.modelId, 'grok-4.6[effort=medium,fast=false]')
    toClient({ jsonrpc: '2.0', id: set.id, result: {} })
    await waitForEvent(events, (event) => event.type === 'connected')
    driver.dispose()
  })

  it('does not fall back to a listed Fast default after the overlay is rejected', async () => {
    const events: DriverEvent[] = []
    const { proc, outbound, toClient } = fakeStdio()
    const dir = await mkdtemp(join(tmpdir(), 'vav-acp-fast-fallback-'))

    const driver = wireAcp(
      'cursor',
      proc,
      {
        binary: 'cursor-agent',
        cwd: dir,
        approvalMode: 'edit',
        model: 'grok-4.6',
        thinkingLevel: 'high',
        fast: false
      },
      (event) => events.push(event)
    )

    const init = await waitFor(outbound, (msg) => msg.method === 'initialize')
    toClient({
      jsonrpc: '2.0',
      id: init.id,
      result: {
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true },
        authMethods: []
      }
    })

    const created = await waitFor(outbound, (msg) => msg.method === 'session/new')
    toClient({
      jsonrpc: '2.0',
      id: created.id,
      result: {
        sessionId: 'sess-fast',
        models: {
          currentModelId: 'default[]',
          availableModels: [{ modelId: 'grok-4.6[effort=high,fast=true]', name: 'grok-4.6' }]
        }
      }
    })

    const overlay = await waitFor(outbound, (msg) => msg.method === 'session/set_model')
    assert.equal(asRecord(overlay.params)?.modelId, 'grok-4.6[effort=high,fast=false]')
    toClient({
      jsonrpc: '2.0',
      id: overlay.id,
      error: { code: RpcErrorCode.invalidParams, message: 'Invalid params' }
    })
    await waitForEvent(events, (event) => event.type === 'connected')

    const setModels = outbound.filter((msg) => msg.method === 'session/set_model')
    assert.equal(setModels.length, 1)
    assert.ok(
      setModels.every((msg) => asRecord(msg.params)?.modelId !== 'grok-4.6[effort=high,fast=true]')
    )

    driver.applyOptions?.({ fast: true })
    const enabled = await waitForNth(outbound, (msg) => msg.method === 'session/set_model', 2)
    assert.equal(asRecord(enabled.params)?.modelId, 'grok-4.6[effort=high,fast=true]')
    toClient({ jsonrpc: '2.0', id: enabled.id, result: {} })
    driver.dispose()
  })

  it('re-pins the current Fast chip before a follow-up prompt', async () => {
    const events: DriverEvent[] = []
    const { proc, outbound, toClient } = fakeStdio()
    const dir = await mkdtemp(join(tmpdir(), 'vav-acp-fast-prompt-'))

    const driver = wireAcp(
      'cursor',
      proc,
      {
        binary: 'cursor-agent',
        cwd: dir,
        approvalMode: 'edit',
        model: 'grok-4.6',
        thinkingLevel: 'high',
        fast: true
      },
      (event) => events.push(event)
    )

    const init = await waitFor(outbound, (msg) => msg.method === 'initialize')
    toClient({
      jsonrpc: '2.0',
      id: init.id,
      result: {
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true },
        authMethods: []
      }
    })

    const created = await waitFor(outbound, (msg) => msg.method === 'session/new')
    toClient({
      jsonrpc: '2.0',
      id: created.id,
      result: {
        sessionId: 'sess-fast-prompt',
        models: {
          currentModelId: 'default[]',
          availableModels: [{ modelId: 'grok-4.6[effort=high,fast=true]', name: 'grok-4.6' }]
        }
      }
    })

    const bootSet = await waitFor(outbound, (msg) => msg.method === 'session/set_model')
    assert.equal(asRecord(bootSet.params)?.modelId, 'grok-4.6[effort=high,fast=true]')
    toClient({ jsonrpc: '2.0', id: bootSet.id, result: {} })
    await waitForEvent(events, (event) => event.type === 'connected')

    driver.applyOptions?.({ fast: false })
    const flipped = await waitForNth(outbound, (msg) => msg.method === 'session/set_model', 2)
    assert.equal(asRecord(flipped.params)?.modelId, 'grok-4.6[effort=high,fast=false]')
    toClient({ jsonrpc: '2.0', id: flipped.id, result: {} })

    driver.prompt('hello again')
    const pinned = await waitForNth(outbound, (msg) => msg.method === 'session/set_model', 3)
    assert.equal(asRecord(pinned.params)?.modelId, 'grok-4.6[effort=high,fast=false]')
    toClient({ jsonrpc: '2.0', id: pinned.id, result: {} })
    const prompt = await waitFor(outbound, (msg) => msg.method === 'session/prompt')
    assert.equal(asRecord(prompt.params)?.sessionId, 'sess-fast-prompt')
    toClient({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } })
    await waitForEvent(events, (event) => event.type === 'turn-finished' && event.success === true)
    driver.dispose()
  })
})

describe('wireAcp grok protocol', () => {
  async function handshakeGrok(
    toClient: (value: unknown) => void,
    outbound: JsonRpc[],
    extras?: {
      sessionId?: string
      loadError?: boolean
      resumeError?: boolean
      auth?: boolean
    }
  ): Promise<void> {
    const init = await waitFor(outbound, (msg) => msg.method === 'initialize')
    toClient({
      jsonrpc: '2.0',
      id: init.id,
      result: {
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: false, embeddedContext: true }
        },
        authMethods: extras?.auth
          ? [
              { id: 'cached_token', name: 'Cached token' },
              { id: 'grok.com', name: 'Grok.com' }
            ]
          : [],
        _meta: { availableCommands: [{ name: 'compact', description: 'Compact' }] }
      }
    })
    if (extras?.auth) {
      const auth = await waitFor(outbound, (msg) => msg.method === 'authenticate')
      assert.equal(asRecord(auth.params)?.methodId, 'cached_token')
      toClient({ jsonrpc: '2.0', id: auth.id, result: {} })
    }
    if (extras?.loadError) {
      const loaded = await waitFor(outbound, (msg) => msg.method === 'session/load')
      toClient({
        jsonrpc: '2.0',
        id: loaded.id,
        error: { code: RpcErrorCode.resourceNotFound, message: 'Session not found' }
      })
      const resumed = await waitFor(outbound, (msg) => msg.method === 'session/resume')
      if (extras.resumeError) {
        toClient({
          jsonrpc: '2.0',
          id: resumed.id,
          error: { code: RpcErrorCode.resourceNotFound, message: 'Session not found' }
        })
      } else {
        toClient({
          jsonrpc: '2.0',
          id: resumed.id,
          result: grokSessionResult(extras.sessionId ?? 'sess-resume')
        })
        return
      }
    }
    const created = await waitFor(outbound, (msg) => msg.method === 'session/new')
    const requested = asRecord(created.params)?.modelId
    if (requested) assert.equal(String(requested).includes('['), false)
    toClient({
      jsonrpc: '2.0',
      id: created.id,
      result: grokSessionResult(extras?.sessionId ?? 'sess-grok')
    })
  }

  function grokSessionResult(sessionId: string): Record<string, unknown> {
    return {
      sessionId,
      models: {
        currentModelId: 'grok-4.5',
        availableModels: [
          {
            modelId: 'grok-4.5',
            name: 'Grok 4.5',
            _meta: { totalContextTokens: 500_000, supportsReasoningEffort: true }
          }
        ]
      },
      _meta: {
        'x.ai/sessionConfig': {
          options: [
            { id: 'grok-4.5', category: 'model', label: 'Grok 4.5', selected: true },
            { id: 'low', category: 'mode', label: 'Low Effort', selected: false },
            { id: 'high', category: 'mode', label: 'High Effort', selected: true }
          ]
        }
      }
    }
  }

  it('authenticates, pins a plain model + effort, and does not invent plan modes', async () => {
    const events: DriverEvent[] = []
    const { proc, outbound, toClient } = fakeStdio()
    const dir = await mkdtemp(join(tmpdir(), 'vav-acp-grok-'))
    const driver = wireAcp(
      'grok',
      proc,
      {
        binary: 'grok',
        cwd: dir,
        approvalMode: 'bypass',
        model: 'grok-4.5',
        thinkingLevel: 'high',
        extraArgs: ['--always-approve', '--permission-mode', 'bypassPermissions']
      },
      (event) => events.push(event)
    )

    await handshakeGrok(toClient, outbound, { auth: true })
    const setModel = await waitFor(outbound, (msg) => msg.method === 'session/set_model')
    assert.equal(asRecord(setModel.params)?.modelId, 'grok-4.5')
    toClient({ jsonrpc: '2.0', id: setModel.id, result: {} })
    const setMode = await waitFor(outbound, (msg) => msg.method === 'session/set_mode')
    assert.equal(asRecord(setMode.params)?.modeId, 'high')
    toClient({ jsonrpc: '2.0', id: setMode.id, result: {} })

    await waitForEvent(events, (event) => event.type === 'connected')
    const session = events.find((event) => event.type === 'session-state' && event.state.thinkingLevels)
    assert.ok(session && session.type === 'session-state')
    assert.deepEqual(session.state.thinkingLevels, ['low', 'high'])
    assert.equal(session.state.modes?.length ?? 0, 0)
    assert.equal(session.state.currentModeId ?? null, null)
    const usage = events.find((event) => event.type === 'usage' && event.contextSize === 500_000)
    assert.ok(usage)

    driver.applyOptions?.({ mode: 'plan' })
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(outbound.filter((msg) => msg.method === 'session/set_mode').length, 1)

    driver.applyOptions?.({ thinkingLevel: 'low' })
    const pinned = await waitForNth(outbound, (msg) => msg.method === 'session/set_model', 2)
    toClient({ jsonrpc: '2.0', id: pinned.id, result: {} })
    const effort = await waitForNth(outbound, (msg) => msg.method === 'session/set_mode', 2)
    assert.equal(asRecord(effort.params)?.modeId, 'low')
    toClient({ jsonrpc: '2.0', id: effort.id, result: {} })
    driver.dispose()
  })

  it('continues on the same session and carries a resume handoff after load/resume fail', async () => {
    const events: DriverEvent[] = []
    const { proc, outbound, toClient } = fakeStdio()
    const dir = await mkdtemp(join(tmpdir(), 'vav-acp-grok-resume-'))
    const driver = wireAcp(
      'grok',
      proc,
      {
        binary: 'grok',
        cwd: dir,
        approvalMode: 'edit',
        model: 'grok-4.5',
        cursor: { provider: 'grok', sessionId: 'stale-sess' },
        resumeHandoff: () => 'Prior transcript:\nuser: hi\nassistant: hello'
      },
      (event) => events.push(event)
    )

    await handshakeGrok(toClient, outbound, {
      loadError: true,
      resumeError: true,
      sessionId: 'fresh-sess'
    })
    const setModel = await waitFor(outbound, (msg) => msg.method === 'session/set_model')
    toClient({ jsonrpc: '2.0', id: setModel.id, result: {} })
    await waitForEvent(events, (event) => event.type === 'connected')

    driver.prompt('what next?')
    const setAgain = await waitForNth(outbound, (msg) => msg.method === 'session/set_model', 2)
    toClient({ jsonrpc: '2.0', id: setAgain.id, result: {} })
    const first = await waitFor(outbound, (msg) => msg.method === 'session/prompt')
    const blocks = asRecord(first.params)?.prompt
    const text = Array.isArray(blocks) ? asRecord(blocks[0])?.text : ''
    assert.match(String(text), /Prior transcript/)
    assert.match(String(text), /what next/)
    toClient({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'fresh-sess',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'one' } }
      }
    })
    toClient({ jsonrpc: '2.0', id: first.id, result: { stopReason: 'end_turn' } })
    await waitForEvent(events, (event) => event.type === 'turn-finished' && event.success === true)

    driver.prompt('and then?')
    const setThird = await waitForNth(outbound, (msg) => msg.method === 'session/set_model', 3)
    toClient({ jsonrpc: '2.0', id: setThird.id, result: {} })
    const second = await waitForNth(outbound, (msg) => msg.method === 'session/prompt', 2)
    const secondBlocks = asRecord(second.params)?.prompt
    const secondText = Array.isArray(secondBlocks) ? asRecord(secondBlocks[0])?.text : ''
    assert.equal(secondText, 'and then?')
    assert.equal(asRecord(second.params)?.sessionId, 'fresh-sess')
    assert.equal(asRecord(first.params)?.sessionId, 'fresh-sess')
    driver.dispose()
  })

  it('answers Grok exit_plan_mode and ask_user_question on the x.ai contract', async () => {
    const events: DriverEvent[] = []
    const { proc, outbound, toClient } = fakeStdio()
    const dir = await mkdtemp(join(tmpdir(), 'vav-acp-grok-plan-'))
    const driver = wireAcp(
      'grok',
      proc,
      { binary: 'grok', cwd: dir, approvalMode: 'edit' },
      (event) => events.push(event)
    )
    await handshakeGrok(toClient, outbound)
    await waitForEvent(events, (event) => event.type === 'connected')

    driver.prompt('plan this')
    const prompt = await waitFor(outbound, (msg) => msg.method === 'session/prompt')
    toClient({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-grok',
        update: { sessionUpdate: 'tool_call_delta_chunk', tool_call_id: 'call-1', name: 'todo_write' }
      }
    })
    await waitForEvent(events, (event) => event.type === 'tool' && event.name === 'todo_write')

    toClient({
      jsonrpc: '2.0',
      id: 9101,
      method: '_x.ai/exit_plan_mode',
      params: { planContent: '# Do it\n\nWrite hello.txt', name: 'Do it' }
    })
    const plan = await waitForEvent(
      events,
      (event) => event.type === 'elicitation' && event.kind === 'plan_doc'
    )
    driver.respond(plan.requestId, 'allow')
    const planResult = await waitFor(outbound, (msg) => msg.id === 9101 && msg.result !== undefined)
    assert.deepEqual(planResult.result, { outcome: 'accepted' })

    toClient({
      jsonrpc: '2.0',
      id: 9102,
      method: '_x.ai/ask_user_question',
      params: {
        questions: [
          {
            question: 'Which colour should the banner be?',
            options: [{ label: 'Red' }, { label: 'Blue' }],
            multiSelect: false
          }
        ]
      }
    })
    const ask = await waitForEvent(events, (event) => event.type === 'elicitation' && event.kind === 'ask')
    driver.respond(
      ask.requestId,
      'allow',
      JSON.stringify({ answers: [{ questionIndex: 0, value: 'Red' }] })
    )
    const askResult = await waitFor(outbound, (msg) => msg.id === 9102 && msg.result !== undefined)
    assert.deepEqual(askResult.result, {
      outcome: 'accepted',
      answers: { 'Which colour should the banner be?': 'Red' }
    })

    toClient({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-grok',
        update: { sessionUpdate: 'session_summary_generated', title: 'Write hello.txt' }
      }
    })
    await waitForEvent(
      events,
      (event) => event.type === 'session-state' && event.state.sessionTitle === 'Write hello.txt'
    )

    toClient({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } })
    await waitForEvent(events, (event) => event.type === 'turn-finished' && event.success === true)
    driver.dispose()
  })

  it('boots kiro, cline, and devin through the shared ACP client', async () => {
    for (const host of ['kiro', 'cline', 'devin'] as const) {
      const events: DriverEvent[] = []
      const { proc, outbound, toClient } = fakeStdio()
      const dir = await mkdtemp(join(tmpdir(), `vav-acp-${host}-`))
      const driver = wireAcp(
        host,
        proc,
        { binary: host, cwd: dir, approvalMode: 'edit' },
        (event) => events.push(event)
      )
      const init = await waitFor(outbound, (msg) => msg.method === 'initialize')
      toClient({
        jsonrpc: '2.0',
        id: init.id,
        result: {
          protocolVersion: ACP_PROTOCOL_VERSION,
          agentCapabilities: { loadSession: true },
          authMethods: []
        }
      })
      const created = await waitFor(outbound, (msg) => msg.method === 'session/new')
      toClient({
        jsonrpc: '2.0',
        id: created.id,
        result: {
          sessionId: `${host}-1`,
          modes: {
            currentModeId: 'agent',
            availableModes: [
              { id: 'agent', name: 'Agent' },
              { id: 'plan', name: 'Plan' }
            ]
          }
        }
      })
      await waitForEvent(events, (event) => event.type === 'connected')
      const session = events.find((event) => event.type === 'session-state')
      assert.ok(session && session.type === 'session-state')
      assert.equal(session.state.currentModeId, 'agent')
      driver.applyOptions?.({ mode: 'plan' })
      const mode = await waitFor(outbound, (msg) => msg.method === 'session/set_mode')
      assert.equal(asRecord(mode.params)?.modeId, 'plan')
      toClient({ jsonrpc: '2.0', id: mode.id, result: {} })
      driver.prompt('hello')
      const prompt = await waitFor(outbound, (msg) => msg.method === 'session/prompt')
      assert.equal(asRecord(prompt.params)?.sessionId, `${host}-1`)
      toClient({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: `${host}-1`,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: `${host} hi` }
          }
        }
      })
      toClient({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } })
      await waitForEvent(events, (event) => event.type === 'text-delta' && event.text === `${host} hi`)
      await waitForEvent(events, (event) => event.type === 'turn-finished' && event.success === true)
      driver.dispose()
    }
  })
})

describe('ACP goal (Grok)', () => {
  it('reads initialize _meta.goal, idle snapshots, and _session/goal', async () => {
    const events: DriverEvent[] = []
    const { proc, outbound, toClient } = fakeStdio()
    const dir = await mkdtemp(join(tmpdir(), 'vav-acp-goal-'))
    const driver = wireAcp(
      'grok',
      proc,
      { binary: 'grok', cwd: dir, approvalMode: 'edit' },
      (event) => events.push(event)
    )

    const init = await waitFor(outbound, (msg) => msg.method === 'initialize')
    toClient({
      jsonrpc: '2.0',
      id: init.id,
      result: {
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true },
        authMethods: [],
        _meta: {
          goal: { version: 1, controlMethod: '_session/goal', actions: ['clear'] }
        }
      }
    })

    const created = await waitFor(outbound, (msg) => msg.method === 'session/new')
    toClient({
      jsonrpc: '2.0',
      id: created.id,
      result: {
        sessionId: 'sess-goal',
        availableCommands: [{ name: 'compact' }]
      }
    })
    await waitForEvent(events, (event) => event.type === 'connected')
    const seeded = events.find(
      (event) =>
        event.type === 'session-state' &&
        event.state.commands?.some((command) => command.name === 'goal')
    )
    assert.ok(seeded && seeded.type === 'session-state')
    assert.equal(seeded.state.goalCapability?.controlMethod, '_session/goal')
    assert.deepEqual(seeded.state.goalCapability?.methodActions, ['clear'])
    assert.ok(seeded.state.goalCapability?.actions.includes('pause'))

    toClient({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-goal',
        update: {
          sessionUpdate: 'session_info_update',
          title: 'Auth',
          _meta: { goal: { objective: 'Migrate auth', status: 'active' } }
        }
      }
    })
    const snap = await waitForEvent(
      events,
      (event) => event.type === 'session-state' && event.state.goal?.status === 'active'
    )
    assert.ok(snap.type === 'session-state')
    assert.equal(snap.state.goal?.objective, 'Migrate auth')

    driver.applyOptions?.({ goal: { action: 'clear' } })
    const control = await waitFor(outbound, (msg) => msg.method === '_session/goal')
    assert.deepEqual(asRecord(control.params), { sessionId: 'sess-goal', action: 'clear' })
    toClient({ jsonrpc: '2.0', id: control.id, result: {} })
    await waitForEvent(
      events,
      (event) => event.type === 'session-state' && event.state.goal === null
    )
    driver.dispose()
  })

  it('optimistically applies Grok /goal slash when the extension is absent', async () => {
    const events: DriverEvent[] = []
    const { proc, outbound, toClient } = fakeStdio()
    const dir = await mkdtemp(join(tmpdir(), 'vav-acp-goal-slash-'))
    const driver = wireAcp(
      'grok',
      proc,
      { binary: 'grok', cwd: dir, approvalMode: 'edit' },
      (event) => events.push(event)
    )

    const init = await waitFor(outbound, (msg) => msg.method === 'initialize')
    toClient({
      jsonrpc: '2.0',
      id: init.id,
      result: {
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true },
        authMethods: []
      }
    })
    const created = await waitFor(outbound, (msg) => msg.method === 'session/new')
    toClient({
      jsonrpc: '2.0',
      id: created.id,
      result: { sessionId: 'sess-slash', availableCommands: [] }
    })
    await waitForEvent(events, (event) => event.type === 'connected')

    driver.prompt('/goal All tests pass')
    const prompt = await waitFor(outbound, (msg) => msg.method === 'session/prompt')
    const blocks = asRecord(prompt.params)?.prompt
    const first = Array.isArray(blocks) ? asRecord(blocks[0]) : null
    assert.equal(first?.text, '/goal All tests pass')
    const set = await waitForEvent(
      events,
      (event) => event.type === 'session-state' && event.state.goal?.objective === 'All tests pass'
    )
    assert.ok(set.type === 'session-state')
    assert.equal(set.state.goal?.status, 'active')
    assert.equal(set.state.goalCapability?.controlMethod, 'slash')

    toClient({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } })
    await waitForEvent(events, (event) => event.type === 'turn-finished')

    driver.prompt('/goal pause')
    await waitForNth(outbound, (msg) => msg.method === 'session/prompt', 2)
    const paused = await waitForEvent(
      events,
      (event) => event.type === 'session-state' && event.state.goal?.status === 'paused'
    )
    assert.ok(paused.type === 'session-state')
    assert.equal(paused.state.goal?.objective, 'All tests pass')
    driver.dispose()
  })
})

describe('acpInvokeArgs', () => {
  it('pins Cursor --model before the acp subcommand', () => {
    assert.deepEqual(
      acpInvokeArgs('cursor', 'edit', {
        model: 'grok-4.6',
        thinkingLevel: 'medium',
        fast: false
      }),
      ['--model', 'grok-4.6[effort=medium,fast=false]', 'acp']
    )
    assert.deepEqual(acpInvokeArgs('cursor', 'edit', {}), ['acp'])
    assert.deepEqual(
      acpInvokeArgs('cursor', 'edit', { model: 'grok-4.6', extraArgs: ['--model', 'auto'] }),
      ['acp', '--model', 'auto']
    )
  })

  it('places Grok flags around agent / stdio', () => {
    assert.deepEqual(
      acpInvokeArgs('grok', 'edit', {
        model: 'grok-4.5',
        thinkingLevel: 'high',
        extraArgs: ['--always-approve', '--permission-mode', 'bypassPermissions']
      }),
      [
        '--permission-mode',
        'bypassPermissions',
        'agent',
        '-m',
        'grok-4.5',
        '--reasoning-effort',
        'high',
        '--always-approve',
        'stdio'
      ]
    )
    assert.deepEqual(acpInvokeArgs('grok', 'edit', { model: 'grok-4.5[effort=high]' }), [
      'agent',
      '-m',
      'grok-4.5',
      'stdio'
    ])
  })

  it('keeps Kiro / Cline / Devin ACP flags on their CLI shape', () => {
    assert.deepEqual(acpInvokeArgs('kiro', 'bypass', {}), ['acp', '--trust-all-tools'])
    assert.deepEqual(acpInvokeArgs('kiro', 'edit', {}), ['acp'])
    assert.deepEqual(acpInvokeArgs('cline', 'auto', {}), ['--acp', '--auto-approve', 'true'])
    assert.deepEqual(acpInvokeArgs('cline', 'edit', {}), ['--acp'])
    assert.deepEqual(
      acpInvokeArgs('devin', 'bypass', { extraArgs: ['--permission-mode', 'bypass'] }),
      ['acp', '--permission-mode', 'bypass']
    )
  })
})

async function waitForNth(
  outbound: JsonRpc[],
  pred: (msg: JsonRpc) => boolean,
  n: number,
  timeoutMs = 1_000
): Promise<JsonRpc> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const found = outbound.filter(pred)
    if (found.length >= n) return found[n - 1]!
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(
    `timed out waiting for ${n} matching RPC among ${JSON.stringify(outbound.map((m) => m.method ?? m.id))}`
  )
}

async function waitForEvent(
  events: DriverEvent[],
  pred: (event: DriverEvent) => boolean,
  timeoutMs = 1_000
): Promise<Extract<DriverEvent, { type: string }>> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const found = events.find(pred)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for driver event among ${events.map((e) => e.type).join(',')}`)
}
