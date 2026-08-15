import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatMessage } from '@shared/types'
import { isAgentPickerLocked } from './agentPickerLock.ts'

function user(id: string): ChatMessage {
  return {
    id,
    parentId: null,
    role: 'user',
    content: 'hi',
    blocks: [],
    createdAt: 0
  }
}

describe('isAgentPickerLocked', () => {
  it('stays open on a seeded empty thread', () => {
    assert.equal(isAgentPickerLocked([]), false)
  })

  it('locks once a message exists', () => {
    assert.equal(isAgentPickerLocked([user('1')]), true)
  })

  it('locks while the thread is still hydrating', () => {
    assert.equal(isAgentPickerLocked(undefined), true)
  })
})
