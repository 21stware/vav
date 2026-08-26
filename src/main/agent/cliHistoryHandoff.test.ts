import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatMessage } from '@shared/types'
import {
  applyCliHistoryHandoff,
  formatCliWorkspaceHandoff
} from './cliHistoryHandoff.ts'

function user(id: string, text: string, parentId: string | null = null): ChatMessage {
  return {
    id,
    parentId,
    role: 'user',
    content: text,
    blocks: [{ kind: 'text', text }],
    createdAt: 1
  }
}

function assistant(id: string, text: string, parentId: string): ChatMessage {
  return {
    id,
    parentId,
    role: 'assistant',
    content: text,
    blocks: [{ kind: 'text', text }],
    createdAt: 2
  }
}

describe('formatCliWorkspaceHandoff', () => {
  it('returns null when there is no prior path', () => {
    assert.equal(
      formatCliWorkspaceHandoff({
        messages: [],
        leafId: null,
        nextCwd: '/new'
      }),
      null
    )
  })

  it('returns null when the only message is the live prompt', () => {
    const current = user('u2', 'next question')
    assert.equal(
      formatCliWorkspaceHandoff({
        messages: [current],
        leafId: 'u2',
        excludeMessageId: 'u2',
        nextCwd: '/new'
      }),
      null
    )
  })

  it('includes prior turns and the new cwd, but not the live prompt', () => {
    const messages = [
      user('u1', 'what is in src?'),
      assistant('a1', 'A TypeScript app.', 'u1'),
      user('u2', 'now look at /other', 'a1')
    ]
    const text = formatCliWorkspaceHandoff({
      messages,
      leafId: 'u2',
      excludeMessageId: 'u2',
      previousCwd: '/old/project',
      nextCwd: '/other'
    })
    assert.ok(text)
    assert.match(text, /changed from \/old\/project to \/other/)
    assert.match(text, /what is in src\?/)
    assert.match(text, /A TypeScript app/)
    assert.doesNotMatch(text, /now look at \/other/)
    assert.match(text, /user's next message follows/i)
  })

  it('folds compacted turns into the summary prefix', () => {
    const messages = [
      user('u1', 'first'),
      assistant('a1', 'ok first', 'u1'),
      user('u2', 'second', 'a1'),
      assistant('a2', 'ok second', 'u2'),
      user('u3', 'third', 'a2')
    ]
    const text = formatCliWorkspaceHandoff({
      messages,
      leafId: 'u3',
      excludeMessageId: 'u3',
      nextCwd: '/new',
      previousCwd: '/old',
      compactions: [
        {
          leafId: 'u3',
          keepAfterMessageId: 'u2',
          summary: 'We looked at the first turn.',
          createdAt: 9,
          compactedCount: 2,
          estimatedContextTokens: 100
        }
      ]
    })
    assert.ok(text)
    assert.match(text, /Conversation summary/)
    assert.match(text, /We looked at the first turn/)
    assert.doesNotMatch(text, /^User:\nfirst$/m)
    assert.match(text, /second/)
  })
})

describe('applyCliHistoryHandoff', () => {
  it('leaves the prompt alone when there is nothing to prepend', () => {
    assert.equal(applyCliHistoryHandoff('hello', null), 'hello')
    assert.equal(applyCliHistoryHandoff('hello', '  '), 'hello')
  })

  it('puts the live prompt after the handoff', () => {
    assert.equal(applyCliHistoryHandoff('hello', 'PRIOR'), 'PRIOR\n\nhello')
  })
})
