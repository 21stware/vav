import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isDuplicateTokenSnapshot,
  usageContextFill,
  usageEventIsNoop,
  usageHasTurnTokens
} from './cliUsage.ts'

describe('cliUsage', () => {
  it('detects turn tokens and duplicate snapshots', () => {
    assert.equal(usageHasTurnTokens(1, 0, 0, 0), true)
    assert.equal(usageHasTurnTokens(0, 0, 0, 0), false)
    const last = {
      newInputTokens: 2,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 1
    }
    assert.equal(isDuplicateTokenSnapshot(last, 2, 3, 0, 1), true)
    assert.equal(isDuplicateTokenSnapshot(last, 2, 4, 0, 1), false)
    assert.equal(isDuplicateTokenSnapshot(null, 2, 3, 0, 1), false)
  })

  it('prefers contextUsed then snapshot total, and no-ops empty pings', () => {
    assert.equal(usageContextFill(12, 99), 12)
    assert.equal(usageContextFill(undefined, 99), 99)
    assert.equal(usageContextFill(-1, 99), 99)
    assert.equal(
      usageEventIsNoop({
        fill: null,
        recordHistory: false,
        contextSize: null,
        sessionCostUsd: null,
        quotaChanged: false
      }),
      true
    )
    assert.equal(
      usageEventIsNoop({
        fill: 1,
        recordHistory: false,
        quotaChanged: false
      }),
      false
    )
  })
})
