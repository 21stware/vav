import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  cuaEmbeddedMcpServer,
  parseCuaConnection,
  sanitizeComputerAct,
  sanitizeComputerObserve
} from './computerUse.ts'

describe('sanitizeComputerObserve', () => {
  it('requires a bound window', () => {
    assert.equal(sanitizeComputerObserve({}).ok, false)
    assert.equal(sanitizeComputerObserve({ pid: 12 }).ok, false)
    const ok = sanitizeComputerObserve({ pid: 12, window_id: 99, query: 'Save' })
    assert.deepEqual(ok, {
      ok: true,
      tool: 'get_window_state',
      payload: { pid: 12, window_id: 99, query: 'Save' }
    })
  })
})

describe('sanitizeComputerAct', () => {
  it('refuses activate, desktop scope, and foreground', () => {
    const activate = sanitizeComputerAct({
      kind: 'click',
      pid: 1,
      window_id: 2,
      x: 1,
      y: 1,
      activate: true
    })
    assert.equal(activate.ok, false)
    if (!activate.ok) assert.match(activate.error, /must not activate/)
    const desktop = sanitizeComputerAct({
      kind: 'click',
      pid: 1,
      window_id: 2,
      x: 1,
      y: 1,
      scope: 'desktop'
    })
    assert.equal(desktop.ok, false)
    if (!desktop.ok) assert.match(desktop.error, /desktop-scope/)
    const front = sanitizeComputerAct({
      kind: 'click',
      pid: 1,
      window_id: 2,
      x: 1,
      y: 1,
      delivery_mode: 'foreground'
    })
    assert.equal(front.ok, false)
    if (!front.ok) assert.match(front.error, /foreground delivery is disabled/)
  })

  it('forces background and prefers element tokens', () => {
    const click = sanitizeComputerAct({
      kind: 'click',
      pid: 8,
      window_id: 3,
      element_token: 'tok-1',
      delivery_mode: 'background'
    })
    assert.deepEqual(click, {
      ok: true,
      tool: 'click',
      payload: { delivery_mode: 'background', pid: 8, window_id: 3, element_token: 'tok-1' }
    })
  })

  it('requires snapshot_id with element_index', () => {
    assert.match(
      sanitizeComputerAct({ kind: 'click', pid: 1, window_id: 2, element_index: 4 }).error ?? '',
      /snapshot_id/
    )
    const ok = sanitizeComputerAct({
      kind: 'click',
      pid: 1,
      window_id: 2,
      element_index: 4,
      snapshot_id: 'snap'
    })
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.payload.element_index, 4)
      assert.equal(ok.payload.snapshot_id, 'snap')
    }
  })

  it('launch only needs a bundle id and still cannot front', () => {
    const launch = sanitizeComputerAct({ kind: 'launch', bundle_id: 'com.apple.calculator' })
    assert.deepEqual(launch, {
      ok: true,
      tool: 'launch_app',
      payload: { delivery_mode: 'background', bundle_id: 'com.apple.calculator' }
    })
    assert.equal(sanitizeComputerAct({ kind: 'launch' }).ok, false)
  })

  it('type and key require bound windows', () => {
    assert.equal(sanitizeComputerAct({ kind: 'type', text: 'hi' }).ok, false)
    const typed = sanitizeComputerAct({ kind: 'type', pid: 1, window_id: 2, text: 'hi' })
    assert.equal(typed.ok, true)
    if (typed.ok) assert.equal(typed.tool, 'type_text')
    const key = sanitizeComputerAct({ kind: 'key', pid: 1, window_id: 2, key: 'Return' })
    assert.equal(key.ok, true)
    if (key.ok) assert.equal(key.tool, 'press_key')
  })
})

describe('cuaEmbeddedMcpServer', () => {
  it('points ACP hosts at the embedded daemon socket, never --direct', () => {
    const server = cuaEmbeddedMcpServer({
      socketPath: '/tmp/vav-cua.sock',
      binPath: '/app/cua-driver',
      generation: 1,
      startedAt: '2026-01-01T00:00:00.000Z'
    })
    assert.equal(server.type, 'stdio')
    assert.equal(server.name, 'vav-computer')
    assert.equal(server.command, '/app/cua-driver')
    assert.deepEqual(server.args, [
      'mcp',
      '--embedded',
      '--socket',
      '/tmp/vav-cua.sock',
      '--host-bundle-id',
      'com.vav.app'
    ])
    assert.equal(server.args.includes('--direct'), false)
  })
})

describe('parseCuaConnection', () => {
  it('rejects incomplete files', () => {
    assert.equal(parseCuaConnection({ socketPath: '/tmp/x' }), null)
    assert.deepEqual(
      parseCuaConnection({
        socketPath: '/tmp/s',
        binPath: '/bin/cua-driver',
        generation: 2,
        startedAt: '2026-01-01T00:00:00.000Z'
      }),
      {
        socketPath: '/tmp/s',
        binPath: '/bin/cua-driver',
        generation: 2,
        startedAt: '2026-01-01T00:00:00.000Z'
      }
    )
  })
})
