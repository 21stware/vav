import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateOwner } from './localOwnerAuth.ts'

describe('evaluateOwner', () => {
  it('skips evaluation when the host says so', async () => {
    const result = await evaluateOwner('Reveal', {
      skip: () => true,
      fallbackConfirm: async () => false
    })
    assert.deepEqual(result, { ok: true })
  })

  it('prefers Touch ID evaluate when available', async () => {
    const calls: string[] = []
    const result = await evaluateOwner('Show key', {
      canPromptTouchID: () => true,
      promptTouchID: async (reason) => {
        calls.push(reason)
      },
      fallbackConfirm: async () => {
        throw new Error('fallback should not run')
      }
    })
    assert.deepEqual(result, { ok: true })
    assert.deepEqual(calls, ['Show key'])
  })

  it('treats a Touch ID rejection as cancelled', async () => {
    const result = await evaluateOwner('Show key', {
      canPromptTouchID: () => true,
      promptTouchID: async () => {
        throw new Error('User canceled')
      }
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.cancelled, true)
  })

  it('falls back to confirm when biometrics are unavailable', async () => {
    const ok = await evaluateOwner('Show key', {
      canPromptTouchID: () => false,
      fallbackConfirm: async () => true
    })
    assert.deepEqual(ok, { ok: true })
    const denied = await evaluateOwner('Show key', {
      fallbackConfirm: async () => false
    })
    assert.deepEqual(denied, { ok: false, cancelled: true })
  })
})
