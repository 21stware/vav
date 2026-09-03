import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clearCompactionPatch, compactionSucceededPatch, refreshTokenUsagePatch } from './sessionUsage.ts'
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

describe('refreshTokenUsagePatch', () => {
  it('writes token overlay maps and tokensUsed for one conversation', () => {
    const next = refreshTokenUsagePatch(
      {
        tokenHistories: { c1: [{ n: 1 }], c2: [{ n: 2 }] },
        cacheCreatedAt: { c1: 1, c2: 2 },
        cacheExpiresAt: { c1: 3, c2: 4 },
        conversations: [
          { id: 'c1', tokensUsed: 10, title: 'keep' },
          { id: 'c2', tokensUsed: 20 }
        ]
      },
      'c1',
      {
        tokenHistory: [{ n: 9 }],
        cacheCreatedAt: 11,
        cacheExpiresAt: 12,
        tokensUsed: 42
      }
    )
    assert.deepEqual(next.tokenHistories.c1, [{ n: 9 }])
    assert.deepEqual(next.tokenHistories.c2, [{ n: 2 }])
    assert.equal(next.cacheCreatedAt.c1, 11)
    assert.equal(next.cacheExpiresAt.c1, 12)
    assert.equal(next.conversations[0]?.tokensUsed, 42)
    assert.equal(next.conversations[0]?.title, 'keep')
    assert.equal(next.conversations[1]?.tokensUsed, 20)
  })
})

describe('clearCompactionPatch', () => {
  it('drops one leaf compaction and leaves other sessions untouched', () => {
    const next = clearCompactionPatch(
      {
        compactions: {
          c1: [
            { leafId: 'keep' },
            { leafId: 'drop' }
          ],
          c2: [{ leafId: 'other' }]
        }
      },
      'c1',
      'drop'
    )
    assert.deepEqual(next.compactions.c1, [{ leafId: 'keep' }])
    assert.deepEqual(next.compactions.c2, [{ leafId: 'other' }])
  })
})
