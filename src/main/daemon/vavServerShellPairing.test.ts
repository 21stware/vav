import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DAEMON_PROTO_VERSION, encodeDaemonPairing } from '../../shared/daemonProtocol.ts'
import { isLoopbackPairedHost, loopbackVavServerShell } from './vavServerShellPairing.ts'

describe('loopbackVavServerShell', () => {
  it('accepts a 127.0.0.1 vav-server pairing', () => {
    const pairing = encodeDaemonPairing({
      v: DAEMON_PROTO_VERSION,
      secret: '0123456789abcdef0123',
      machineId: 'vav-server-1',
      name: 'VAV Daemon',
      host: '127.0.0.1',
      port: 4750,
      addresses: ['127.0.0.1']
    })
    const shell = loopbackVavServerShell(pairing)
    assert.ok(shell)
    assert.equal(shell.port, 4750)
    assert.equal(shell.secret, '0123456789abcdef0123')
    assert.equal(shell.pairing, pairing)
  })

  it('rejects a LAN vav-server so this computer does not advertise another host', () => {
    const pairing = encodeDaemonPairing({
      v: DAEMON_PROTO_VERSION,
      secret: '0123456789abcdef0123',
      machineId: 'vav-server-1',
      name: 'Office',
      host: '10.0.0.8',
      port: 4750,
      addresses: ['10.0.0.8']
    })
    assert.equal(loopbackVavServerShell(pairing), null)
  })

  it('treats loopback-only persisted hosts as the local shell', () => {
    assert.equal(isLoopbackPairedHost({ host: '127.0.0.1', addresses: ['127.0.0.1'] }), true)
    assert.equal(isLoopbackPairedHost({ host: '10.0.0.8', addresses: ['10.0.0.8'] }), false)
  })

  it('rejects empty or malformed pairing', () => {
    assert.equal(loopbackVavServerShell(null), null)
    assert.equal(loopbackVavServerShell(''), null)
    assert.equal(loopbackVavServerShell('not-a-pairing'), null)
  })
})
