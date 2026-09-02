import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeConversationList, type ConversationListItem } from './sessionListMerge.ts'

function row(
  partial: Partial<ConversationListItem> & { id: string }
): ConversationListItem {
  return {
    updatedAt: 1,
    pinned: false,
    pinTime: null,
    archived: false,
    archivedAt: null,
    ...partial
  }
}

describe('mergeConversationList', () => {
  it('keeps previous order when only titles change', () => {
    const prev = [row({ id: 'a', updatedAt: 2 }), row({ id: 'b', updatedAt: 1 })]
    const next = [row({ id: 'b', updatedAt: 1 }), row({ id: 'a', updatedAt: 2 })]
    assert.deepEqual(
      mergeConversationList(prev, next).map((c) => c.id),
      ['a', 'b']
    )
  })

  it('re-sorts when updatedAt changes and keeps hydrated file sessions', () => {
    const prev = [
      row({ id: 'old', updatedAt: 3 }),
      row({ id: 'file', updatedAt: 0, fileId: 'f1' })
    ]
    const next = [row({ id: 'old', updatedAt: 4 }), row({ id: 'new', updatedAt: 5 })]
    assert.deepEqual(
      mergeConversationList(prev, next).map((c) => c.id),
      ['new', 'old', 'file']
    )
  })
})
