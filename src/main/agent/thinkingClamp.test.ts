import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nextAllowedThinkingLevel } from './thinkingClamp.ts'

describe('nextAllowedThinkingLevel', () => {
  it('is a no-op when allowed is empty or already included', () => {
    assert.equal(nextAllowedThinkingLevel('max', undefined), null)
    assert.equal(nextAllowedThinkingLevel('max', []), null)
    assert.equal(nextAllowedThinkingLevel('high', ['low', 'high']), null)
  })

  it('prefers max, else the last allowed level', () => {
    assert.equal(nextAllowedThinkingLevel('high', ['low', 'max']), 'max')
    assert.equal(nextAllowedThinkingLevel('high', ['low', 'medium']), 'medium')
  })
})
