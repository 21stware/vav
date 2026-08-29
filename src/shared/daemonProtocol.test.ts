import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  encodeDaemonLine,
  encodeDaemonPairing,
  parseDaemonAnnounce,
  parseDaemonClientFrame,
  parseDaemonHello,
  parseDaemonPairing,
  parseDaemonServerFrame
} from './daemonProtocol.ts'

describe('daemon hello', () => {
  it('accepts a daemon-role hello', () => {
    const msg = parseDaemonHello({ type: 'hello', proto: 1, auth: 'secret-value-16+', role: 'daemon' })
    assert.ok(msg)
    assert.equal(msg.role, 'daemon')
  })

  it('rejects a phone-style hello without role', () => {
    assert.equal(parseDaemonHello({ type: 'hello', proto: 1, auth: 'secret-value-16+' }), null)
  })
})

describe('daemon client frames', () => {
  it('parses req and ping', () => {
    assert.deepEqual(parseDaemonClientFrame({ type: 'ping' }), { type: 'ping' })
    assert.deepEqual(parseDaemonClientFrame({ type: 'req', id: '1', method: 'fs.stat', params: { path: '/' } }), {
      type: 'req',
      id: '1',
      method: 'fs.stat',
      params: { path: '/' }
    })
  })

  it('rejects a req without a method', () => {
    assert.equal(parseDaemonClientFrame({ type: 'req', id: '1' }), null)
  })
})

describe('daemon server frames', () => {
  it('parses welcome', () => {
    const frame = parseDaemonServerFrame({
      type: 'welcome',
      proto: 1,
      app: 'vavd',
      version: '1.0.0',
      host: { id: 'box', name: 'build', kind: 'remote', online: true },
      home: '/home/u',
      tmp: '/tmp'
    })
    assert.ok(frame)
    assert.equal(frame.type, 'welcome')
    if (frame.type === 'welcome') assert.equal(frame.host.id, 'box')
  })

  it('parses res and stream', () => {
    assert.deepEqual(parseDaemonServerFrame({ type: 'res', id: '1', ok: true, result: { exists: true } }), {
      type: 'res',
      id: '1',
      ok: true,
      result: { exists: true },
      error: undefined
    })
    assert.equal(parseDaemonServerFrame({ type: 'stream', stream: 'p-1', event: 'stdout' })?.type, 'stream')
  })
})

describe('daemon pairing', () => {
  it('round-trips the JSON payload', () => {
    const encoded = encodeDaemonPairing({
      v: 1,
      secret: '0123456789abcdef0123',
      machineId: 'm1',
      name: 'build',
      host: '10.0.0.2',
      port: 4750
    })
    const parsed = parseDaemonPairing(encoded)
    assert.ok(parsed)
    assert.equal(parsed.machineId, 'm1')
    assert.equal(parsed.port, 4750)
  })

  it('accepts host:port#secret', () => {
    const parsed = parseDaemonPairing('10.0.0.2:4750#0123456789abcdef0123')
    assert.ok(parsed)
    assert.equal(parsed.host, '10.0.0.2')
    assert.equal(parsed.port, 4750)
  })

  it('accepts host:port secret', () => {
    const parsed = parseDaemonPairing('10.0.0.2:4750 0123456789abcdef0123')
    assert.ok(parsed)
    assert.equal(parsed.secret, '0123456789abcdef0123')
  })

  it('rejects a short secret', () => {
    assert.equal(parseDaemonPairing('10.0.0.2:4750#short'), null)
  })
})

describe('announce', () => {
  it('accepts a multicast payload', () => {
    const parsed = parseDaemonAnnounce({
      v: 1,
      kind: 'vav-daemon',
      machineId: 'm1',
      name: 'box',
      port: 4750
    })
    assert.ok(parsed)
    assert.equal(parsed.port, 4750)
  })

  it('rejects other kinds', () => {
    assert.equal(parseDaemonAnnounce({ v: 1, kind: 'other', machineId: 'm', name: 'n', port: 1 }), null)
  })
})

describe('encodeDaemonLine', () => {
  it('terminates with a newline', () => {
    assert.equal(encodeDaemonLine({ type: 'ping' }), '{"type":"ping"}\n')
  })
})
