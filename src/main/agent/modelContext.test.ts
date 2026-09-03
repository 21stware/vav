import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { collectPreferredModelHosts, contextWindowForModelId, conversationModelHealPatch } from './modelContext.ts'

describe('modelContext', () => {
  it('prefers catalogue then host-reported then the fallback table', () => {
    assert.equal(contextWindowForModelId('claude', 'opus', 200_000, 1, () => 8), 200_000)
    assert.equal(contextWindowForModelId('claude', 'opus', 0, 80_000, () => 8), 80_000)
    assert.equal(contextWindowForModelId(null, 'x', 0, 80_000, () => 8), 8)
  })

  it('collects structured hosts from recents then conversations', () => {
    assert.deepEqual(
      collectPreferredModelHosts(
        [{ hostId: 'claude' }, { hostId: 'nope' }],
        [{ cliHost: 'codex' }, { cliHost: null }]
      ),
      ['claude', 'codex']
    )
  })

  it('heals Cursor fast chips and mismatched model ids', () => {
    const fast = conversationModelHealPatch({
      host: 'cursor',
      currentModel: 'grok-4.6-low-fast',
      currentFast: false,
      resolved: 'grok-4.6',
      tokenLimit: 99
    })
    assert.equal(fast.fast, true)
    assert.equal(fast.model, 'grok-4.6')
    assert.equal(fast.tokenLimit, 99)
    assert.deepEqual(
      conversationModelHealPatch({
        host: 'claude',
        currentModel: 'opus',
        resolved: 'opus',
        tokenLimit: 1
      }),
      {}
    )
  })
})
