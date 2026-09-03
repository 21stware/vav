import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ConversationMeta } from '../../../shared/types.ts'
import { applyCliHostSetResult } from './sessionCliHost.ts'

function conv(id: string, extra: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    model: 'm',
    pinned: false,
    pinTime: null,
    archived: false,
    archivedAt: null,
    ...extra
  } as ConversationMeta
}

describe('applyCliHostSetResult', () => {
  const base = {
    conversations: [conv('a', { model: 'old' }), conv('b')],
    messages: { a: [], b: [] },
    messagesHydrated: { a: false, b: true },
    activeLeaf: { a: null as string | null, b: 'leaf' },
    compactions: { a: [], b: [] },
    tokenHistories: { a: [], b: [] },
    cacheCreatedAt: { a: null as number | null, b: 1 },
    cacheExpiresAt: { a: null as number | null, b: 2 },
    pendingReviewByConversation: { a: { changeSetId: 'cs', count: 1 } },
    turns: { a: { isRunning: true }, b: { isRunning: false } },
    liveUsage: { a: { tokensUsed: 3 }, b: { tokensUsed: 4 } },
    activeId: 'a' as string | null,
    errorBanner: 'err' as string | null,
    errorBannerKind: 'error' as string | null,
    errorBannerDetail: 'detail' as string | null
  }

  it('hydrates a parked transcript and clears the active error banner on host change', () => {
    const next = applyCliHostSetResult(base, 'a', {
      conversations: [conv('a', { model: 'kept' }), conv('b')],
      hostChanged: true,
      transcript: {
        messages: [{ id: 'm1', parentId: null, role: 'user', content: 'hi', blocks: [], createdAt: 1 }],
        activeLeafId: 'm1',
        compactions: [],
        tokenHistory: [],
        tokensUsed: 12,
        cacheCreatedAt: 9,
        cacheExpiresAt: 10,
        cliResumeCursor: null,
        cliHost: 'claude',
        model: 'sonnet',
        quotaWindows: []
      }
    })
    assert.equal(next.conversations.find((c) => c.id === 'a')?.model, 'sonnet')
    assert.equal(next.conversations.find((c) => c.id === 'a')?.tokensUsed, 12)
    assert.equal(next.messages.a?.[0]?.content, 'hi')
    assert.equal(next.messagesHydrated.a, true)
    assert.equal(next.activeLeaf.a, 'm1')
    assert.equal(next.pendingReviewByConversation.a, undefined)
    assert.equal(next.turns.a, undefined)
    assert.equal(next.turns.b?.isRunning, false)
    assert.equal(next.liveUsage.a, undefined)
    assert.equal(next.liveUsage.b?.tokensUsed, 4)
    assert.equal(next.errorBanner, null)
    assert.equal(next.cacheCreatedAt.a, 9)
  })

  it('keeps banners and overlays when the host did not change', () => {
    const next = applyCliHostSetResult(base, 'a', {
      conversations: base.conversations,
      hostChanged: false,
      transcript: null
    })
    assert.equal(next.messages, base.messages)
    assert.equal(next.pendingReviewByConversation.a?.changeSetId, 'cs')
    assert.equal(next.turns.a?.isRunning, true)
    assert.equal(next.errorBanner, 'err')
    assert.equal(next.liveUsage.a, undefined)
    assert.equal(next.liveUsage.b?.tokensUsed, 4)
  })
})
