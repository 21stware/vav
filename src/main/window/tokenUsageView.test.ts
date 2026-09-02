import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveContextTokens } from './tokenUsageView.ts'

describe('resolveContextTokens', () => {
  it('prefers compaction estimate, then last input, then tokensUsed', () => {
    assert.deepEqual(resolveContextTokens(40, 10, 2), {
      contextTokens: 40,
      contextTokensEstimated: true
    })
    assert.deepEqual(resolveContextTokens(0, 10, 2), {
      contextTokens: 10,
      contextTokensEstimated: false
    })
    assert.deepEqual(resolveContextTokens(0, 0, 2), {
      contextTokens: 2,
      contextTokensEstimated: false
    })
  })
})
