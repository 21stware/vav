import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  acknowledgeConversation,
  addAttentionItem,
  dockBadgeLabel,
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
