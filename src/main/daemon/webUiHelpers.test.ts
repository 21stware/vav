import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { encodeDaemonPairing } from '../../shared/daemonProtocol.ts'
import {
  escapeHtml,
  formatConnectHint,
  pairingAuthFromInput,
  parseHostHeader,
  webHostAllowed
} from './webUiHelpers.ts'

describe('pairingAuthFromInput', () => {
  it('extracts the secret from a printed pairing URI', () => {
    const uri = encodeDaemonPairing({
      v: 1,
      secret: '0123456789abcdef0123',
      machineId: 'box',
      name: 'Box',
      host: '127.0.0.1',
      port: 4750
    })
    assert.equal(pairingAuthFromInput(`  ${uri}  `), '0123456789abcdef0123')
  })

  it('accepts host:port#secret and a raw secret', () => {
    assert.equal(pairingAuthFromInput('10.0.0.2:4750#0123456789abcdef0123'), '0123456789abcdef0123')
    assert.equal(pairingAuthFromInput('10.0.0.2:4750 0123456789abcdef0123'), '0123456789abcdef0123')
    assert.equal(pairingAuthFromInput('plain-secret'), 'plain-secret')
    assert.equal(pairingAuthFromInput('   '), '')
  })
})

describe('escapeHtml', () => {
  it('neutralizes markup in session titles', () => {
    assert.equal(escapeHtml(`<img src=x onerror=alert(1)>`), '&lt;img src=x onerror=alert(1)&gt;')
    assert.equal(escapeHtml(`a&b "c"`), 'a&amp;b &quot;c&quot;')
  })
})

describe('webHostAllowed', () => {
  it('locks loopback pages to loopback Host headers', () => {
    assert.equal(webHostAllowed('127.0.0.1:4752', '127.0.0.1'), true)
    assert.equal(webHostAllowed('localhost:4752', '127.0.0.1'), true)
    assert.equal(webHostAllowed('[::1]:4752', '::1'), true)
    assert.equal(webHostAllowed('evil.example:4752', '127.0.0.1'), false)
    assert.equal(webHostAllowed(undefined, '127.0.0.1'), false)
    assert.equal(webHostAllowed('evil.example', '0.0.0.0'), true)
    assert.equal(parseHostHeader('[::1]:4752'), '::1')
    assert.match(formatConnectHint('127.0.0.1', 4750), /is it running/)
  })
})
