import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { collectPreferredModelHosts, contextWindowForModelId } from './modelContext.ts'

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
})
