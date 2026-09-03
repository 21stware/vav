import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { compactionSucceededPatch } from './sessionUsage.ts'
import type { LeafCompaction } from '../../../shared/types.ts'

describe('compactionSucceededPatch', () => {
  it('stamps the leaf compaction and shrinks tokensUsed', () => {
    const compaction: LeafCompaction = {
      leafId: 'leaf',
      keepAfterMessageId: 'keep',
      summary: 'folded',
      createdAt: 1,
      compactedCount: 2,
      estimatedContextTokens: 40
    }
    const next = compactionSucceededPatch(
      {
        compactions: { c1: [] },
        liveUsage: { c1: { n: 1 }, c2: { n: 2 } },
        conversations: [{ id: 'c1', tokensUsed: 99 }]
      },
      'c1',
      compaction
    )
    assert.deepEqual(next.compactions.c1, [compaction])
    assert.equal(next.conversations[0]?.tokensUsed, 40)
    assert.equal('c1' in next.liveUsage, false)
    assert.deepEqual(next.liveUsage.c2, { n: 2 })
  })
})
