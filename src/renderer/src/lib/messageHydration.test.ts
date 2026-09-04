import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatMessage } from '../../../shared/types.ts'
import {
  conversationFullHydratePatch,
  conversationHydrationMetaPatch,
  conversationHydrationRefreshPatch,
  conversationTokenCachePatch,
  isCurrentHydration,
  mergeHydratedMessages,
  nextHydrationGeneration,
  omitConversationCachePatch,
  omitKeys,
  omitLiveStreamingMessage,
  omitMappedKeys,
  SESSION_DELETE_MAPPED_KEYS
} from './messageHydration.ts'

function msg(id: string, content: string, parentId: string | null = null): ChatMessage {
  return {
    id,
    parentId,
    role: 'user',
    content,
    blocks: [],
    createdAt: 1
  }
}

describe('mergeHydratedMessages', () => {
  it('returns disk when live is empty', () => {
    const disk = [msg('a', 'disk')]
    assert.deepEqual(mergeHydratedMessages(disk, undefined), disk)
    assert.deepEqual(mergeHydratedMessages(disk, []), disk)
  })

  it('keeps live turns that arrived after the disk snapshot', () => {
    const disk = [msg('a', 'from-disk')]
    const live = [msg('a', 'from-disk'), msg('b', 'streamed', 'a')]
    const merged = mergeHydratedMessages(disk, live)
    assert.deepEqual(
      merged.map((m) => m.id),
      ['a', 'b']
    )
    assert.equal(merged[1]?.content, 'streamed')
  })

  it('lets live win on the same id (streaming overlay)', () => {
    const disk = [msg('a', 'old')]
    const live = [msg('a', 'newer-stream')]
    const merged = mergeHydratedMessages(disk, live)
    assert.equal(merged.length, 1)
    assert.equal(merged[0]?.content, 'newer-stream')
  })
})

describe('hydration generations', () => {
  it('drops a stale apply after a newer load starts', () => {
    const gens = new Map<string, number>()
    const first = nextHydrationGeneration(gens, 'c1')
    const second = nextHydrationGeneration(gens, 'c1')
    assert.equal(isCurrentHydration(gens, 'c1', first), false)
    assert.equal(isCurrentHydration(gens, 'c1', second), true)
  })
})

describe('omitKeys', () => {
  it('removes per-conversation maps and preserves others', () => {
    const map = { keep: 1, gone: 2, also: 3 }
    const next = omitKeys(map, ['gone', 'missing'])
    assert.deepEqual(next, { keep: 1, also: 3 })
    assert.equal(map.gone, 2)
  })

  it('returns the same object when nothing is removed', () => {
    const map = { keep: 1 }
    assert.equal(omitKeys(map, ['nope']), map)
  })
})

describe('omitConversationCachePatch', () => {
  it('drops messages and leaf for one id without touching others', () => {
    const state = {
      messages: { keep: [{ id: 'k' }], gone: [{ id: 'g' }] },
      activeLeaf: { keep: 'k', gone: 'g' }
    }
    const next = omitConversationCachePatch(state, 'gone')
    assert.deepEqual(next.messages, { keep: [{ id: 'k' }] })
    assert.deepEqual(next.activeLeaf, { keep: 'k' })
    assert.equal(state.messages.gone?.[0]?.id, 'g')
    assert.ok(SESSION_DELETE_MAPPED_KEYS.includes('messages'))
    assert.ok(SESSION_DELETE_MAPPED_KEYS.includes('pendingReviewByConversation'))
  })
})

describe('omitMappedKeys', () => {
  it('omits the same ids from several maps', () => {
    const state = {
      messages: { a: [1], b: [2] },
      drafts: { a: 'keep', b: 'drop' },
      title: 'session'
    }
    const next = omitMappedKeys(state, ['messages', 'drafts'] as const, ['b'])
    assert.deepEqual(next.messages, { a: [1] })
    assert.deepEqual(next.drafts, { a: 'keep' })
    assert.equal('title' in next, false)
  })
})

describe('omitLiveStreamingMessage', () => {
  it('drops the live assistant id only while a turn is running', () => {
    const messages = { c: [{ id: 'live' }, { id: 'keep' }] }
    assert.equal(
      omitLiveStreamingMessage(messages, 'c', { isRunning: false, messageId: 'live' }),
      messages
    )
    assert.deepEqual(
      omitLiveStreamingMessage(messages, 'c', { isRunning: true, messageId: 'live' }).c?.map(
        (m) => m.id
      ),
      ['keep']
    )
    assert.equal(
      omitLiveStreamingMessage(messages, 'c', { isRunning: true, messageId: 'missing' }),
      messages
    )
  })
})

describe('conversation cache maps', () => {
  it('patches token overlay without touching other ids', () => {
    const state = {
      tokenHistories: { a: [{ tokens: 1 }], b: [{ tokens: 2 }] },
      cacheCreatedAt: { a: 1, b: 2 },
      cacheExpiresAt: { a: 3, b: 4 }
    }
    const next = conversationTokenCachePatch(state, 'a', {
      tokenHistory: [{ tokens: 9 }],
      cacheCreatedAt: 10,
      cacheExpiresAt: null
    })
    assert.deepEqual(next.tokenHistories.a, [{ tokens: 9 }])
    assert.deepEqual(next.tokenHistories.b, [{ tokens: 2 }])
    assert.equal(next.cacheCreatedAt.a, 10)
    assert.equal(next.cacheExpiresAt.a, null)
  })

  it('includes compaction snapshots for a hydrated load', () => {
    const state = {
      compactions: { a: [{ id: 'old' }] },
      tokenHistories: { a: [] },
      cacheCreatedAt: { a: null },
      cacheExpiresAt: { a: null }
    }
    const next = conversationHydrationMetaPatch(state, 'a', {
      compactions: [{ id: 'new' }],
      tokenHistory: [{ n: 1 }],
      cacheCreatedAt: 2,
      cacheExpiresAt: 3
    })
    assert.deepEqual(next.compactions.a, [{ id: 'new' }])
    assert.deepEqual(next.tokenHistories.a, [{ n: 1 }])
    assert.equal(next.cacheCreatedAt.a, 2)
  })

  it('merges live turns and stamps full hydration maps', () => {
    const state = {
      messages: { a: [msg('a', 'live-newer')] },
      messagesHydrated: {},
      activeLeaf: { a: 'old' },
      compactions: { a: [{ id: 'old' }] },
      tokenHistories: { a: [] },
      cacheCreatedAt: { a: null },
      cacheExpiresAt: { a: null }
    }
    const next = conversationFullHydratePatch(state, 'a', {
      messages: [msg('a', 'disk'), msg('b', 'from-disk', 'a')],
      activeLeafId: 'leaf',
      compactions: [{ id: 'new' }],
      tokenHistory: [{ n: 1 }],
      cacheCreatedAt: 2,
      cacheExpiresAt: 3
    })
    assert.deepEqual(
      next.messages.a.map((m) => m.id),
      ['a', 'b']
    )
    assert.equal(next.messages.a[0]?.content, 'live-newer')
    assert.equal(next.messagesHydrated.a, true)
    assert.equal(next.activeLeaf.a, 'leaf')
    assert.deepEqual(next.compactions.a, [{ id: 'new' }])
    assert.equal(next.cacheCreatedAt.a, 2)
  })

  it('merges new disk messages when returning to a hydrated remote session', () => {
    const state = {
      messages: { a: [msg('u0', 'older')] },
      messagesHydrated: { a: true },
      activeLeaf: { a: 'u0' },
      compactions: { a: [] },
      tokenHistories: { a: [] },
      cacheCreatedAt: { a: null },
      cacheExpiresAt: { a: null }
    }
    const next = conversationHydrationRefreshPatch(state, 'a', {
      messages: [msg('u0', 'older'), msg('u1', 'from master', 'u0')],
      activeLeafId: 'u1',
      tokenHistory: [],
      cacheCreatedAt: null,
      cacheExpiresAt: null
    })
    assert.ok('messages' in next)
    if (!('messages' in next)) return
    assert.deepEqual(
      next.messages.a.map((m) => m.id),
      ['u0', 'u1']
    )
    assert.equal(next.activeLeaf.a, 'u1')
  })
})
