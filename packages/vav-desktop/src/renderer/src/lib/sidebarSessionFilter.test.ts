import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  conversationMatchesFilter,
  encodeSidebarSessionFilter,
  isSessionRunning,
  isSessionUnread,
  parseSidebarSessionFilter
} from './sidebarSessionFilter.ts'
import type { ConversationMeta } from '@shared/types'

function conv(partial: Partial<ConversationMeta> & Pick<ConversationMeta, 'id'>): ConversationMeta {
  return {
    title: partial.title ?? partial.id,
    createdAt: 0,
    updatedAt: 0,
    workingDirectory: partial.workingDirectory ?? '/tmp/ws',
    model: 'x',
    tokensUsed: 0,
    tokenLimit: 0,
    pinned: false,
    pinTime: null,
    duplicateSourceId: null,
    duplicateSourceTitle: null,
    archived: false,
    archivedAt: null,
    approvalMode: 'auto',
    ...partial
  }
}

describe('sidebarSessionFilter', () => {
  it('round-trips none / active / favorite / workspace', () => {
    assert.deepEqual(parseSidebarSessionFilter(undefined), { kind: 'none' })
    assert.deepEqual(parseSidebarSessionFilter('active'), { kind: 'active' })
    assert.deepEqual(parseSidebarSessionFilter('favorite'), { kind: 'favorite' })
    assert.deepEqual(parseSidebarSessionFilter('ws:/Users/me/repo'), {
      kind: 'workspace',
      path: '/Users/me/repo'
    })
    assert.equal(encodeSidebarSessionFilter({ kind: 'favorite' }), 'favorite')
    assert.equal(encodeSidebarSessionFilter({ kind: 'workspace', path: '/a' }), 'ws:/a')
  })

  it('matches running or unread for Active Session', () => {
    const row = conv({ id: 'a' })
    assert.equal(
      conversationMatchesFilter(row, { kind: 'active' }, {
        running: true,
        unread: false,
        favoriteIds: new Set()
      }),
      true
    )
    assert.equal(
      conversationMatchesFilter(row, { kind: 'active' }, {
        running: false,
        unread: true,
        favoriteIds: new Set()
      }),
      true
    )
    assert.equal(
      conversationMatchesFilter(row, { kind: 'active' }, {
        running: false,
        unread: false,
        favoriteIds: new Set()
      }),
      false
    )
  })

  it('matches starred ids and workdir paths', () => {
    const row = conv({ id: 'fav', workingDirectory: '/Users/me/vav/' })
    assert.equal(
      conversationMatchesFilter(row, { kind: 'favorite' }, {
        running: false,
        unread: false,
        favoriteIds: new Set(['fav'])
      }),
      true
    )
    assert.equal(
      conversationMatchesFilter(row, { kind: 'workspace', path: '/Users/me/vav' }, {
        running: false,
        unread: false,
        favoriteIds: new Set()
      }),
      true
    )
  })
})

describe('isSessionRunning', () => {
  it('treats a live turn, running activity, or busy shell as running', () => {
    assert.equal(isSessionRunning({ isRunning: true }), true)
    assert.equal(isSessionRunning({ activity: 'running' }), true)
    assert.equal(isSessionRunning({ shellBusy: true }), true)
    assert.equal(isSessionRunning({ activity: 'done' }), false)
  })
})

describe('isSessionUnread', () => {
  it('marks idle-after-done, not an awaiting tool card', () => {
    assert.equal(isSessionUnread({ activity: 'done' }), true)
    assert.equal(
      isSessionUnread({ awaitingToolCallId: 't1', isRunning: true, activity: 'done' }),
      false
    )
    assert.equal(isSessionUnread({ isRunning: true, activity: 'done' }), false)
  })

  it('keeps a sticky resultUnseen badge even while running', () => {
    assert.equal(isSessionUnread({ isRunning: true, resultUnseen: true }), true)
    assert.equal(isSessionUnread({ activity: 'idle', resultUnseen: false }), false)
  })
})
