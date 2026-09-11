import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createMenuNonceGate } from './menuNonce.ts'

describe('createMenuNonceGate', () => {
  it('ignores the idle nonce and consumes each increment once', () => {
    const consume = createMenuNonceGate()
    assert.equal(consume(0), false)
    assert.equal(consume(1), true)
    assert.equal(consume(1), false)
    assert.equal(consume(2), true)
  })
})
