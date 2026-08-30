import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  encodeDaemonLine,
  encodeDaemonPairing,
  parseDaemonAnnounce,
  parseDaemonClientFrame,
  parseDaemonHello,
  parseDaemonPairAsk,
  parseDaemonPairing,
  parseDaemonServerFrame,
  parseMachinePairing
} from './daemonProtocol.ts'
import { encodePairing } from './remoteControl.ts'

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
  it('round-trips the URI payload', () => {
    const encoded = encodeDaemonPairing({
      v: 1,
      secret: '0123456789abcdef0123',
      machineId: 'm1',
      name: 'build',
      host: '10.0.0.2',
      port: 4750,
      token: 'tcTOKEN:with.dots',
      addresses: ['10.0.0.2', 'build.local']
    })
    assert.equal(
      encoded,
      'vav-daemon://0123456789abcdef0123@10.0.0.2:4750?name=build&token=tcTOKEN:with.dots&addresses=10.0.0.2,build.local'
    )
    const parsed = parseDaemonPairing(encoded)
    assert.ok(parsed)
    assert.equal(parsed.secret, '0123456789abcdef0123')
    assert.equal(parsed.name, 'build')
    assert.equal(parsed.host, '10.0.0.2')
    assert.equal(parsed.port, 4750)
    assert.equal(parsed.token, 'tcTOKEN:with.dots')
    assert.deepEqual(parsed.addresses, ['10.0.0.2', 'build.local'])
  })

  it('parses the hand-copied URI form', () => {
    const parsed = parseDaemonPairing(
      'vav-daemon://fj9jGXIsAQXx3sBENXWpVKssmz1P1LwM@192.168.50.148:58957?name=Mac&token=tcomFwWCD_vcY41d8mhY7_hYEpd_rlGbkpX4tGQ9iMsTBJBe38T2FygaFhToGjYWhudGMzMDRhLmlwbi5kZXZhNG0xNzIuMjM4LjcuMTI0YTZ4HjI2MDA6M2MxODo6MjAwMDozMWZmOmZlMjk6ZThlOA&addresses=192.168.50.148,Aobos-MacBook-Air.local'
    )
    assert.ok(parsed)
    assert.equal(parsed.secret, 'fj9jGXIsAQXx3sBENXWpVKssmz1P1LwM')
    assert.equal(parsed.host, '192.168.50.148')
    assert.equal(parsed.port, 58957)
    assert.equal(parsed.name, 'Mac')
    assert.equal(parsed.token?.startsWith('tc'), true)
    assert.deepEqual(parsed.addresses, ['192.168.50.148', 'Aobos-MacBook-Air.local'])
  })

  it('rejects a JSON pairing line', () => {
    assert.equal(
      parseDaemonPairing(
        'vav-daemon:{"v":1,"secret":"0123456789abcdef0123","machineId":"m1","name":"build","host":"10.0.0.2","port":4750}'
      ),
      null
    )
  })

  it('brackets an IPv6 host', () => {
    const encoded = encodeDaemonPairing({
      v: 1,
      secret: '0123456789abcdef0123',
      machineId: 'm1',
      name: 'box',
      host: '::1',
      port: 4750
    })
    assert.equal(encoded, 'vav-daemon://0123456789abcdef0123@[::1]:4750?name=box')
    const parsed = parseDaemonPairing(encoded)
    assert.ok(parsed)
    assert.equal(parsed.host, '::1')
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

  it('accepts the phone QR as a machine pairing line', () => {
    const parsed = parseMachinePairing(
      encodePairing({
        v: 1,
        token: 'tcABCDEF',
        secret: '0123456789abcdef0123456789abcdef',
        host: 'Mac-mini-2.local'
      })
    )
    assert.ok(parsed)
    assert.equal(parsed.token, 'tcABCDEF')
    assert.equal(parsed.secret, '0123456789abcdef0123456789abcdef')
    assert.equal(parsed.name, 'Mac-mini-2.local')
    assert.equal(parsed.host, 'Mac-mini-2.local')
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

describe('LAN pair-ask', () => {
  it('parses pair-ask and pair-offer', () => {
    const ask = parseDaemonPairAsk({
      type: 'pair-ask',
      proto: 1,
      name: 'Studio',
      machineId: 'm-1'
    })
    assert.ok(ask)
    assert.equal(ask.name, 'Studio')
    const offer = parseDaemonServerFrame({
      type: 'pair-offer',
      pairing: 'vav-daemon:{"v":1}'
    })
    assert.ok(offer)
    assert.equal(offer.type, 'pair-offer')
    if (offer.type === 'pair-offer') assert.ok(offer.pairing.startsWith('vav-daemon:'))
  })

  it('rejects an empty name', () => {
    assert.equal(parseDaemonPairAsk({ type: 'pair-ask', proto: 1, name: '  ', machineId: 'm' }), null)
  })
})

describe('encodeDaemonLine', () => {
  it('terminates with a newline', () => {
    assert.equal(encodeDaemonLine({ type: 'ping' }), '{"type":"ping"}\n')
  })
})
