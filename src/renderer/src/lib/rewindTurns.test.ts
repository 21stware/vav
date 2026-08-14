import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatMessage } from '../../../shared/types.ts'
import {
  pickRewindTurnAtScroll,
  rewindTurnsFromMessages,
  shouldShowRewind
} from './rewindTurns.ts'

function msg(
  id: string,
  role: ChatMessage['role'],
  content: string,
  parentId: string | null = null
): ChatMessage {
  return {
    id,
    parentId,
    role,
    content,
    blocks: [],
    createdAt: 1
  }
}

describe('rewindTurnsFromMessages', () => {
  it('pairs each user prompt with the following assistant reply', () => {
    const turns = rewindTurnsFromMessages([
      msg('u1', 'user', 'fix the overflow', null),
      msg('a1', 'assistant', 'I will tighten the header CSS.', 'u1'),
      msg('u2', 'user', 'and add rewind', 'a1'),
      msg('a2', 'assistant', 'Adding a left rail.', 'u2')
    ])
    assert.equal(turns.length, 2)
    assert.deepEqual(
      turns.map((t) => t.id),
      ['u1', 'u2']
    )
    assert.equal(turns[0]!.preview, 'fix the overflow')
    assert.equal(turns[0]!.replyPreview, 'I will tighten the header CSS.')
    assert.equal(turns[1]!.preview, 'and add rewind')
  })

  it('skips system messages and trailing user turns without a reply', () => {
    const turns = rewindTurnsFromMessages([
      msg('s', 'system', 'hello'),
      msg('u1', 'user', 'one', 's'),
      msg('a1', 'assistant', 'ok', 'u1'),
      msg('u2', 'user', 'two', 'a1')
    ])
    assert.equal(turns.length, 2)
    assert.equal(turns[1]!.id, 'u2')
    assert.equal(turns[1]!.replyPreview, '')
  })

  it('collapses whitespace in the preview', () => {
    const turns = rewindTurnsFromMessages([msg('u', 'user', '  hello   \n  world  ')])
    assert.equal(turns[0]!.preview, 'hello world')
  })

  it('truncates a long prompt with an ellipsis', () => {
    const long = 'x'.repeat(80)
    const turns = rewindTurnsFromMessages([msg('u', 'user', long)])
    assert.equal(turns[0]!.preview.endsWith('…'), true)
    assert.ok(turns[0]!.preview.length <= 72)
  })
})

describe('shouldShowRewind', () => {
  it('shows as soon as there is a user turn', () => {
    assert.equal(shouldShowRewind([]), false)
    assert.equal(shouldShowRewind([{ id: 'a', preview: 'x', replyPreview: '' }]), true)
    assert.equal(
      shouldShowRewind([
        { id: 'a', preview: 'x', replyPreview: '' },
        { id: 'b', preview: 'y', replyPreview: '' }
      ]),
      true
    )
  })
})

describe('pickRewindTurnAtScroll', () => {
  const turns = [
    { id: 'a', top: 0 },
    { id: 'b', top: 200 },
    { id: 'c', top: 800 }
  ]

  it('returns null when empty', () => {
    assert.equal(pickRewindTurnAtScroll([], 10), null)
  })

  it('keeps the last turn whose top is at or above the focus line', () => {
    assert.equal(pickRewindTurnAtScroll(turns, 0), 'a')
    assert.equal(pickRewindTurnAtScroll(turns, 199), 'a')
    assert.equal(pickRewindTurnAtScroll(turns, 200), 'b')
    assert.equal(pickRewindTurnAtScroll(turns, 900), 'c')
  })
})
