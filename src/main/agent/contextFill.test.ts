import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { estimatedContextFill } from './contextFill.ts'

describe('estimatedContextFill', () => {
  it('skips when usage already landed, the turn cancelled, or history exists', () => {
    assert.equal(
      estimatedContextFill({
        sawUsage: true,
        cancelled: false,
        historyLength: 0,
        estimate: 40,
        tokensUsed: 0
      }),
      null
    )
    assert.equal(
      estimatedContextFill({
        sawUsage: false,
        cancelled: true,
        historyLength: 0,
        estimate: 40,
        tokensUsed: 0
      }),
      null
    )
    assert.equal(
      estimatedContextFill({
        sawUsage: false,
        cancelled: false,
        historyLength: 1,
        estimate: 40,
        tokensUsed: 0
      }),
      null
    )
  })

  it('returns a positive estimate that differs from tokensUsed', () => {
    assert.equal(
      estimatedContextFill({
        sawUsage: false,
        cancelled: false,
        historyLength: 0,
        estimate: 40,
        tokensUsed: 0
      }),
      40
    )
    assert.equal(
      estimatedContextFill({
        sawUsage: false,
        cancelled: false,
        historyLength: 0,
        estimate: 40,
        tokensUsed: 40
      }),
      null
    )
  })
})
