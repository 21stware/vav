import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  cuaEmbeddedMcpServer,
  filterComputerApps,
  formatComputerAppsList,
  mergeComputerApps,
  parseComputerApps,
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

describe('parseComputerApps', () => {
  it('parses a bare JSON array with mixed field spellings', () => {
    const raw = JSON.stringify([
      { name: 'Safari', bundle_id: 'com.apple.Safari', pid: 42 },
      { app_name: 'Notes', bundleId: 'com.apple.Notes' }
    ])
    assert.deepEqual(parseComputerApps(raw), [
      { name: 'Safari', bundleId: 'com.apple.Safari', pid: 42 },
      { name: 'Notes', bundleId: 'com.apple.Notes', pid: null }
    ])
  })

  it('accepts an already-parsed object under apps/items/windows', () => {
    const apps = parseComputerApps({ apps: [{ title: 'Finder', bundle: 'com.apple.finder' }] })
    assert.deepEqual(apps, [{ name: 'Finder', bundleId: 'com.apple.finder', pid: null }])
  })

  it('dedupes by bundle id and drops nameless rows', () => {
    const apps = parseComputerApps([
      { name: 'Safari', bundle_id: 'com.apple.Safari', pid: 1 },
      { name: 'Safari', bundle_id: 'com.apple.Safari', pid: 2 },
      { pid: 3 }
    ])
    assert.deepEqual(apps, [{ name: 'Safari', bundleId: 'com.apple.Safari', pid: 1 }])
  })

  it('returns [] for junk / invalid JSON', () => {
    assert.deepEqual(parseComputerApps('not json'), [])
    assert.deepEqual(parseComputerApps(null), [])
    assert.deepEqual(parseComputerApps(42), [])
  })

  it('unwraps MCP structuredContent and treats pid 0 as not running', () => {
    const apps = parseComputerApps({
      structuredContent: {
        apps: [
          { name: 'Calendar', bundle_id: 'com.apple.iCal', pid: 0, running: false },
          { name: 'Safari', bundle_id: 'com.apple.Safari', pid: 88, running: true }
        ]
      }
    })
    assert.deepEqual(apps, [
      { name: 'Safari', bundleId: 'com.apple.Safari', pid: 88 },
      { name: 'Calendar', bundleId: 'com.apple.iCal', pid: null }
    ])
  })

  it('unwraps a nested result object (not a bare array)', () => {
    const apps = parseComputerApps({
      result: { apps: [{ name: 'Notes', bundle_id: 'com.apple.Notes', pid: 0 }] }
    })
    assert.deepEqual(apps, [{ name: 'Notes', bundleId: 'com.apple.Notes', pid: null }])
  })
})

describe('mergeComputerApps / filterComputerApps', () => {
  it('overlays driver pids onto the installed scan and keeps system apps', () => {
    const merged = mergeComputerApps(
      [
        { name: 'Calendar', bundleId: 'com.apple.iCal', pid: null },
        { name: 'Safari', bundleId: 'com.apple.Safari', pid: null }
      ],
      [{ name: 'Safari', bundleId: 'com.apple.Safari', pid: 42 }]
    )
    assert.deepEqual(merged, [
      { name: 'Safari', bundleId: 'com.apple.Safari', pid: 42 },
      { name: 'Calendar', bundleId: 'com.apple.iCal', pid: null }
    ])
  })

  it('filters by name, compact name, or bundle id and strips @[ ]', () => {
    const apps = [
      { name: 'Google Chrome', bundleId: 'com.google.Chrome', pid: null },
      { name: 'Calendar', bundleId: 'com.apple.iCal', pid: 9 }
    ]
    assert.deepEqual(
      filterComputerApps(apps, '[cal]').map((a) => a.name),
      ['Calendar']
    )
    assert.deepEqual(
      filterComputerApps(apps, 'googlechrome').map((a) => a.name),
      ['Google Chrome']
    )
    assert.deepEqual(
      filterComputerApps(apps, 'apple.ical').map((a) => a.name),
      ['Calendar']
    )
  })

  it('formats a compact agent listing', () => {
    assert.equal(
      formatComputerAppsList([{ name: 'Calendar', bundleId: 'com.apple.iCal', pid: null }]),
      '- Calendar  com.apple.iCal  pid=—'
    )
    assert.equal(formatComputerAppsList([]), '(none)')
  })
})
