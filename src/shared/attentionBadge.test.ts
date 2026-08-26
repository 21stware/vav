import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  acknowledgeConversation,
  addAttentionItem,
  completeAttentionCount,
  completeAttentionId,
  dockBadgeLabel,
  firstCompleteConversation,
  isForegroundConversation,
  type AttentionItem
} from './attentionBadge.ts'

function item(partial: Partial<AttentionItem> & Pick<AttentionItem, 'id'>): AttentionItem {
  return {
    conversationId: 'c1',
    kind: 'ask',
    ...partial
  }
}

describe('addAttentionItem', () => {
  it('appends a new item', () => {
    const next = addAttentionItem([], item({ id: 'a' }))
    assert.equal(next.length, 1)
    assert.equal(next[0]!.id, 'a')
  })

  it('dedupes by id so a repeated awaiting does not double-count', () => {
    const once = addAttentionItem([], item({ id: 'a' }))
    const twice = addAttentionItem(once, item({ id: 'a' }))
    assert.equal(twice.length, 1)
    assert.equal(twice, once)
  })
})

describe('acknowledgeConversation', () => {
  it('drops every item on that session (badge usually falls by 1)', () => {
    const items = [
      item({ id: 'a', conversationId: 'c1', kind: 'ask' }),
      item({ id: 'b', conversationId: 'c2', kind: 'approval' })
    ]
    const next = acknowledgeConversation(items, 'c1')
    assert.deepEqual(
      next.map((row) => row.id),
      ['b']
    )
  })

  it('is a no-op for an empty id', () => {
    const items = [item({ id: 'a' })]
    assert.equal(acknowledgeConversation(items, ''), items)
  })
})

describe('firstCompleteConversation', () => {
  it('returns the earliest Done session, skipping asks', () => {
    const items = [
      item({ id: 'ask', conversationId: 'c-ask', kind: 'ask' }),
      item({ id: completeAttentionId('c-first'), conversationId: 'c-first', kind: 'complete' }),
      item({ id: completeAttentionId('c-later'), conversationId: 'c-later', kind: 'complete' })
    ]
    assert.equal(firstCompleteConversation(items), 'c-first')
  })

  it('is null when nothing has finished unseen', () => {
    assert.equal(firstCompleteConversation([item({ id: 'ask', kind: 'ask' })]), null)
  })
})

describe('dockBadgeLabel', () => {
  it('is empty when there is nothing to handle', () => {
    assert.equal(dockBadgeLabel(0), '')
  })

  it('shows the count and caps at 99+', () => {
    assert.equal(dockBadgeLabel(1), '1')
    assert.equal(dockBadgeLabel(12), '12')
    assert.equal(dockBadgeLabel(100), '99+')
  })
})

describe('completeAttentionCount', () => {
  it('counts unseen Done only', () => {
    assert.equal(
      completeAttentionCount([
        item({ id: 'ask', kind: 'ask' }),
        item({ id: completeAttentionId('c1'), conversationId: 'c1', kind: 'complete' }),
        item({ id: completeAttentionId('c2'), conversationId: 'c2', kind: 'complete' })
      ]),
      2
    )
  })
})

describe('isForegroundConversation', () => {
  const views = new Map<number, string>([[1, 'c1']])

  it('is true only for the visible focused session', () => {
    assert.equal(
      isForegroundConversation('c1', { id: 1, visible: true, minimized: false }, views),
      true
    )
  })

  it('is false when the window is hidden or minimized', () => {
    assert.equal(
      isForegroundConversation('c1', { id: 1, visible: false, minimized: false }, views),
      false
    )
    assert.equal(
      isForegroundConversation('c1', { id: 1, visible: true, minimized: true }, views),
      false
    )
  })

  it('is false for another session or no focus', () => {
    assert.equal(
      isForegroundConversation('c2', { id: 1, visible: true, minimized: false }, views),
      false
    )
    assert.equal(isForegroundConversation('c1', null, views), false)
  })
})
