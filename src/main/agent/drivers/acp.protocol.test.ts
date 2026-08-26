import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, it } from 'node:test'
import { ACP_CLIENT_CAPABILITIES, ACP_PROTOCOL_VERSION } from '../../../shared/acpSession.ts'
import { RpcErrorCode } from '../../../shared/cliErrors.ts'
import { wireAcp } from './acp.ts'
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
})

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
