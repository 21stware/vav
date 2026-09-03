import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isDuplicateTokenSnapshot,
  usageContextFill,
  usageEventIsNoop,
  usageHasTurnTokens,
  usageSnapshotPayload
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

  it('maps a conversation row onto a usage event', () => {
    const payload = usageSnapshotPayload(
      'c1',
      {
        tokensUsed: 9,
        tokenLimit: 100,
        tokenHistory: [{ n: 1 }],
        cacheCreatedAt: 2,
        cacheExpiresAt: null,
        reportedSessionCostUsd: undefined,
        quotaWindows: null
      },
      { newSnapshot: true }
    )
    assert.equal(payload.type, 'usage')
    assert.equal(payload.conversationId, 'c1')
    assert.equal(payload.tokensUsed, 9)
    assert.equal(payload.tokenLimit, 100)
    assert.deepEqual(payload.history, [{ n: 1 }])
    assert.equal(payload.cacheCreatedAt, 2)
    assert.equal(payload.cacheExpiresAt, null)
    assert.equal(payload.reportedSessionCostUsd, null)
    assert.deepEqual(payload.quotaWindows, [])
    assert.equal(payload.newSnapshot, true)
    assert.equal(
      usageSnapshotPayload('c1', {
        tokensUsed: 0,
        tokenLimit: 1,
        tokenHistory: [],
        cacheCreatedAt: null,
        cacheExpiresAt: null
      }).newSnapshot,
      false
    )
  })
})
