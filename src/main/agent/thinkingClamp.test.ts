import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cursorLockedFamilyThinkingPatch, nextAllowedThinkingLevel } from './thinkingClamp.ts'

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

describe('cursorLockedFamilyThinkingPatch', () => {
  it('applies advertised thinking only for locked Cursor families', () => {
    assert.deepEqual(
      cursorLockedFamilyThinkingPatch(
        { cliHost: 'cursor', model: 'kimi-k3', thinkingLevel: 'high' },
        { thinkingLevel: 'max' }
      ),
      { thinkingLevel: 'max' }
    )
    assert.equal(
      cursorLockedFamilyThinkingPatch(
        { cliHost: 'cursor', model: 'grok-4.6', thinkingLevel: 'high' },
        { thinkingLevel: 'max' }
      ),
      null
    )
    assert.equal(
      cursorLockedFamilyThinkingPatch(
        { cliHost: 'claude', model: 'sonnet', thinkingLevel: 'high' },
        { thinkingLevel: 'max' }
      ),
      null
    )
    assert.equal(
      cursorLockedFamilyThinkingPatch(
        { cliHost: 'cursor', model: 'kimi-k3', thinkingLevel: 'max' },
        { thinkingLevel: 'max' }
      ),
      null
    )
  })
})
