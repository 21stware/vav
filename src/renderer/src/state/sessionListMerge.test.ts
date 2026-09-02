import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeConversationList, nextConversationSelection, patchConversationById, isArchivedConversation, regenerateActiveLeaf, canMutateActiveSession, type ConversationListItem } from './sessionListMerge.ts'

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

describe('patchConversationById', () => {
  it('patches one row in place and supports an updater', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', pinned: true })]
    const patched = patchConversationById(rows, 'b', { pinned: false })
    assert.equal(patched[0], rows[0])
    assert.equal(patched[1]?.pinned, false)
    const updated = patchConversationById(rows, 'a', (c) => ({ ...c, archived: true }))
    assert.equal(updated[0]?.archived, true)
    assert.equal(updated[1], rows[1])
  })
})

describe('nextConversationSelection', () => {
  it('toggles additive, never empties, and fills a shift-range', () => {
    assert.deepEqual(
      nextConversationSelection({
        id: 'b',
        selectedIds: ['a'],
        activeId: 'a',
        additive: true,
        listedIds: ['a', 'b', 'c']
      }),
      ['a', 'b']
    )
    assert.deepEqual(
      nextConversationSelection({
        id: 'a',
        selectedIds: ['a'],
        activeId: 'a',
        additive: true,
        listedIds: ['a', 'b']
      }),
      ['a']
    )
    assert.deepEqual(
      nextConversationSelection({
        id: 'c',
        selectedIds: ['a'],
        activeId: 'a',
        range: true,
        listedIds: ['a', 'b', 'c']
      }),
      ['a', 'b', 'c']
    )
    assert.deepEqual(
      nextConversationSelection({
        id: 'c',
        selectedIds: ['b'],
        activeId: 'gone',
        range: true,
        listedIds: ['a', 'b', 'c']
      }),
      ['b', 'c']
    )
    assert.deepEqual(
      nextConversationSelection({
        id: 'c',
        selectedIds: ['x'],
        activeId: 'gone',
        range: true,
        listedIds: ['a', 'b', 'c']
      }),
      ['c']
    )
  })
})

describe('isArchivedConversation', () => {
  it('is true only for a matching archived id', () => {
    const rows = [row({ id: 'a', archived: true }), row({ id: 'b' })]
    assert.equal(isArchivedConversation(rows, 'a'), true)
    assert.equal(isArchivedConversation(rows, 'b'), false)
    assert.equal(isArchivedConversation(rows, 'missing'), false)
    assert.equal(isArchivedConversation(rows, null), false)
    assert.equal(isArchivedConversation(rows, ''), false)
  })
})

describe('regenerateActiveLeaf', () => {
  it('drops an assistant reply to its parent and keeps a user message', () => {
    assert.equal(
      regenerateActiveLeaf({ role: 'assistant', id: 'a1', parentId: 'u1' }),
      'u1'
    )
    assert.equal(
      regenerateActiveLeaf({ role: 'user', id: 'u1', parentId: null }),
      'u1'
    )
  })
})

describe('canMutateActiveSession', () => {
  it('rejects missing, archived, and running sessions', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', archived: true })]
    assert.equal(canMutateActiveSession(null, rows), false)
    assert.equal(canMutateActiveSession('b', rows), false)
    assert.equal(canMutateActiveSession('a', rows, { isRunning: true }), false)
    assert.equal(canMutateActiveSession('a', rows), true)
  })

  it('allows a running session when idle is not required', () => {
    const rows = [row({ id: 'a' })]
    assert.equal(canMutateActiveSession('a', rows, { isRunning: true, requireIdle: false }), true)
  })
})
