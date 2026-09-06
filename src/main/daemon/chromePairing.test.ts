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

  it('reads a secret from an http URL username', () => {
    const parsed = parsePairing('http://abcdefghijklmnopqrstuvwx@127.0.0.1:4800/')
    assert.equal(parsed?.secret, 'abcdefghijklmnopqrstuvwx')
    assert.equal(parsed?.origin, 'http://127.0.0.1:4800')
    assert.equal(parsed?.wsUrl, 'ws://127.0.0.1:4800/vav')
  })

  it('keeps a custom websocket path', () => {
    const parsed = parsePairing('ws://127.0.0.1:4800/custom')
    assert.equal(parsed?.origin, 'http://127.0.0.1:4800')
    assert.equal(parsed?.wsUrl, 'ws://127.0.0.1:4800/custom')
  })

  it('maps https and wss onto TLS', () => {
    const https = parsePairing('https://127.0.0.1:8443/')
    assert.equal(https?.origin, 'https://127.0.0.1:8443')
    assert.equal(https?.wsUrl, 'wss://127.0.0.1:8443/vav')
    const wss = parsePairing('wss://127.0.0.1:8443/vav')
    assert.equal(wss?.origin, 'https://127.0.0.1:8443')
    assert.equal(wss?.wsUrl, 'wss://127.0.0.1:8443/vav')
  })

  it('accepts an IPv6 loopback daemon URI', () => {
    const parsed = parsePairing('vav-daemon://abcdefghijklmnopqrstuvwx@[::1]:4750')
    assert.ok(parsed)
    assert.equal(parsed.host, '::1')
    assert.equal(parsed.origin, 'http://[::1]:4752')
    assert.equal(parsed.wsUrl, 'ws://[::1]:4752/vav')
  })

  it('rejects a short pairing secret', () => {
    assert.equal(parsePairing('vav-daemon://short@127.0.0.1:4750'), null)
    assert.equal(parsePairing('http://short@127.0.0.1:4752/'), null)
    assert.equal(parsePairing('0123456789abcde'), null)
  })
})
