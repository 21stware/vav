import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { encodeDaemonPairing } from '../../shared/daemonProtocol.ts'
import {
  formatVavConnectError,
  formatVavHelp,
  parsePortNumber,
  parseVavCliArgs,
  resolveVavTarget
} from './vavCli.ts'

describe('parseVavCliArgs', () => {
  it('treats empty argv and --help as help', () => {
    assert.equal(parseVavCliArgs([]).kind, 'help')
    assert.equal(parseVavCliArgs(['--help']).kind, 'help')
    assert.equal(parseVavCliArgs(['-h', 'send']).kind, 'help')
    assert.equal(parseVavCliArgs(['--version']).kind, 'version')
    assert.match(formatVavHelp(), /vav cancel/)
    assert.match(formatVavHelp(), /vav reply/)
  })

  it('parses verbs, --flag=value, and rejects unknown flags', () => {
    const send = parseVavCliArgs(['send', 'hello', 'there', '--session=s1'])
    assert.equal(send.kind, 'command')
    if (send.kind !== 'command') return
    assert.equal(send.verb, 'send')
    assert.deepEqual(send.rest, ['hello', 'there'])
    assert.equal(send.flags.get('--session'), 's1')

    const cancel = parseVavCliArgs(['/usr/bin/node', 'vav.js', 'cancel', '--session', 'abc'])
    assert.equal(cancel.kind, 'command')
    if (cancel.kind !== 'command') return
    assert.equal(cancel.verb, 'cancel')

    assert.equal(parseVavCliArgs(['wat']).kind, 'error')
    assert.equal(parseVavCliArgs(['send', '--nope']).kind, 'error')
    assert.equal(parseVavCliArgs(['send', '--session']).kind, 'error')
  })
})

describe('resolveVavTarget', () => {
  it('reads a pairing URI and validates ports', () => {
    const uri = encodeDaemonPairing({
      v: 1,
      secret: '0123456789abcdef0123',
      machineId: 'box',
      name: 'Box',
      host: '10.0.0.2',
      port: 5999
    })
    const target = resolveVavTarget(new Map([['--uri', uri]]))
    assert.equal(target.host, '10.0.0.2')
    assert.equal(target.port, 5999)
    assert.equal(target.secret, '0123456789abcdef0123')
    assert.throws(() => resolveVavTarget(new Map([['--uri', 'not-a-uri']])), /unrecognized/)
    assert.throws(() => parsePortNumber('nope', 4750), /integer/)
    assert.equal(parsePortNumber(undefined, 4750), 4750)
  })

  it('requires a secret when no URI or state file exists', () => {
    assert.throws(
      () => resolveVavTarget(new Map([['--state', '/tmp/vav-missing-state']]), {}),
      /no pairing secret/
    )
  })
})

describe('formatVavConnectError', () => {
  it('rewrites refused connections', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4750'), { code: 'ECONNREFUSED' })
    assert.match(formatVavConnectError(err, { host: '127.0.0.1', port: 4750 }), /is it running/)
    assert.match(formatVavConnectError(new Error('timeout'), { host: '127.0.0.1', port: 1 }), /timeout/)
  })
})
