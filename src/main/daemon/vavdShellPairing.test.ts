import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DAEMON_PROTO_VERSION, encodeDaemonPairing } from '../../shared/daemonProtocol.ts'
import { loopbackVavdShell } from './vavdShellPairing.ts'

describe('loopbackVavdShell', () => {
  it('accepts a 127.0.0.1 vavd pairing', () => {
    const pairing = encodeDaemonPairing({
      v: DAEMON_PROTO_VERSION,
      secret: '0123456789abcdef0123',
      machineId: 'vavd-1',
      name: 'VAV Daemon',
      host: '127.0.0.1',
      port: 4750,
      addresses: ['127.0.0.1']
    })
    const shell = loopbackVavdShell(pairing)
    assert.ok(shell)
    assert.equal(shell.port, 4750)
    assert.equal(shell.secret, '0123456789abcdef0123')
    assert.equal(shell.pairing, pairing)
  })

  it('rejects a LAN vavd so this computer does not advertise another host', () => {
    const pairing = encodeDaemonPairing({
      v: DAEMON_PROTO_VERSION,
      secret: '0123456789abcdef0123',
      machineId: 'vavd-1',
      name: 'Office',
      host: '10.0.0.8',
      port: 4750,
      addresses: ['10.0.0.8']
    })
    assert.equal(loopbackVavdShell(pairing), null)
  })

  it('rejects empty or malformed pairing', () => {
    assert.equal(loopbackVavdShell(null), null)
    assert.equal(loopbackVavdShell(''), null)
    assert.equal(loopbackVavdShell('not-a-pairing'), null)
  })
})
