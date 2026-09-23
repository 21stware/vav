import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isTrustedBridgeHost, isTrustedBridgeOrigin } from './bridgeTrust.ts'

describe('isTrustedBridgeHost', () => {
  it('accepts loopback Host headers for the bound port', () => {
    assert.equal(isTrustedBridgeHost('127.0.0.1:4752', 4752, '127.0.0.1'), true)
    assert.equal(isTrustedBridgeHost('localhost:4752', 4752, '127.0.0.1'), true)
    assert.equal(isTrustedBridgeHost('[::1]:4752', 4752, '127.0.0.1'), true)
  })

  it('rejects a rebinding Host header', () => {
    assert.equal(isTrustedBridgeHost('evil.com', 4752, '127.0.0.1'), false)
    assert.equal(isTrustedBridgeHost('evil.com:4752', 4752, '127.0.0.1'), false)
    assert.equal(isTrustedBridgeHost(undefined, 4752, '127.0.0.1'), false)
  })
})

describe('isTrustedBridgeOrigin', () => {
  it('allows missing Origin and Chrome extensions', () => {
    assert.equal(isTrustedBridgeOrigin(undefined, 4752), true)
    assert.equal(isTrustedBridgeOrigin('chrome-extension://abcdefghijklmnop', 4752), true)
  })

  it('rejects a browser Origin that is not this bridge', () => {
    assert.equal(isTrustedBridgeOrigin('https://evil.com', 4752), false)
    assert.equal(isTrustedBridgeOrigin('http://127.0.0.1:4752', 4752), true)
    assert.equal(isTrustedBridgeOrigin('http://127.0.0.1:9', 4752), false)
  })
})
