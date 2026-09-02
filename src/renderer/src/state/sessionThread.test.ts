import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatMessage } from '../../../shared/types.ts'
import {
  clearPriorChangeReviews,
  resetVisibleMessagesCache,
  upsert,
  visibleMessages
} from './sessionThread.ts'

function msg(partial: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    role: 'assistant',
    content: '',
    blocks: [],
    createdAt: 0,
    parentId: null,
    ...partial
  } as ChatMessage
}

describe('upsert', () => {
  it('appends a new id and preserves changeSetId on a partial replace', () => {
    const a = msg({ id: 'a', changeSetId: 'cs-1' })
    const next = upsert([a], msg({ id: 'b' }))
    assert.equal(next.length, 2)
    const replaced = upsert(next, msg({ id: 'a' }))
    assert.equal(replaced.find((m) => m.id === 'a')?.changeSetId, 'cs-1')
  })
})

describe('visibleMessages', () => {
  it('returns a stable empty array and caches the same nodes/leaf', () => {
    resetVisibleMessagesCache()
    const empty = visibleMessages({ messages: {}, activeLeaf: {} }, 'missing')
    assert.equal(visibleMessages({ messages: {}, activeLeaf: {} }, 'missing'), empty)
    const root = msg({ id: 'root', role: 'user', parentId: null })
    const child = msg({ id: 'child', parentId: 'root' })
    const state = { messages: { c: [root, child] }, activeLeaf: { c: 'child' } }
    const first = visibleMessages(state, 'c')
    const second = visibleMessages(state, 'c')
    assert.equal(first, second)
    assert.deepEqual(
      first.map((m) => m.id),
      ['root', 'child']
    )
  })
})

describe('clearPriorChangeReviews', () => {
  it('strips changeSetId and pending review for that conversation only', () => {
    const a = msg({ id: 'a', changeSetId: 'cs-1' })
    const other = msg({ id: 'o', changeSetId: 'cs-keep' })
    const state = {
      messages: { c: [a], other: [other] },
      changeSetsById: {
        'cs-1': { id: 'cs-1' } as never,
        'cs-keep': { id: 'cs-keep' } as never
      },
      pendingReviewByConversation: { c: { changeSetId: 'cs-1', count: 1 } },
      changeSet: { id: 'cs-1' } as never,
      changeReviewId: 'cs-1'
    }
    const next = clearPriorChangeReviews(state, 'c')
    assert.equal(next.messages?.c?.[0]?.changeSetId, undefined)
    assert.equal(next.messages?.other?.[0]?.changeSetId, 'cs-keep')
    assert.equal(next.changeSetsById?.['cs-1'], undefined)
    assert.ok(next.changeSetsById?.['cs-keep'])
    assert.equal(next.pendingReviewByConversation?.c, undefined)
    assert.equal(next.changeSet, null)
    assert.equal(next.changeReviewId, null)
  })
})
