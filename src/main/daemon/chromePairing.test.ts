import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parsePairing } from '../../../extension/lib/pairing.js'

describe('Chrome extension pairing paste', () => {
  it('reads the desktop Connect vav-daemon URI onto the web bridge', () => {
    const parsed = parsePairing(
      'vav-daemon://abcdefghijklmnopqrstuvwx@127.0.0.1:4750?name=VAV%20Daemon'
    )
    assert.ok(parsed)
    assert.equal(parsed.secret, 'abcdefghijklmnopqrstuvwx')
    assert.equal(parsed.host, '127.0.0.1')
    assert.equal(parsed.origin, 'http://127.0.0.1:4752')
    assert.equal(parsed.wsUrl, 'ws://127.0.0.1:4752/vav')
  })

  it('accepts a local http or ws URL', () => {
    const http = parsePairing('http://127.0.0.1:4752/')
    assert.equal(http?.origin, 'http://127.0.0.1:4752')
    assert.equal(http?.wsUrl, 'ws://127.0.0.1:4752/vav')
    const ws = parsePairing('ws://127.0.0.1:4800/vav')
    assert.equal(ws?.origin, 'http://127.0.0.1:4800')
    assert.equal(ws?.wsUrl, 'ws://127.0.0.1:4800/vav')
  })

  it('still accepts a raw pairing secret', () => {
    const parsed = parsePairing('0123456789abcdef01234567')
    assert.equal(parsed?.secret, '0123456789abcdef01234567')
  })

  it('rejects junk', () => {
    assert.equal(parsePairing(''), null)
    assert.equal(parsePairing('vav-remote:{"v":1}'), null)
    assert.equal(parsePairing('not a secret'), null)
  })
})
