import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatMessage } from './types.ts'
import { leafAfterPrune, pruneSubtree, subtreeIds, forkActiveLeaf, regenerateActiveLeaf, ROOT_LEAF } from './thread.ts'

function msg(
  id: string,
  parentId: string | null,
  role: 'user' | 'assistant' = 'user'
): ChatMessage {
  return {
    id,
    parentId,
    role,
    content: id,
    blocks: [{ kind: 'text', text: id }],
    createdAt: 1
  }
}

describe('subtreeIds / pruneSubtree', () => {
  it('collects the node and every descendant', () => {
    const messages = [
      msg('u1', null),
      msg('a1', 'u1', 'assistant'),
      msg('u2', 'a1'),
      msg('a2', 'u2', 'assistant'),
      msg('a1b', 'u1', 'assistant')
    ]
    const ids = subtreeIds(messages, 'a1')
    assert.deepEqual([...ids].sort(), ['a1', 'a2', 'u2'])
    const pruned = pruneSubtree(messages, 'a1')
    assert.deepEqual(
      pruned.messages.map((m) => m.id),
      ['u1', 'a1b']
    )
  })

  it('is a no-op for an unknown id', () => {
    const messages = [msg('u1', null)]
    const pruned = pruneSubtree(messages, 'missing')
    assert.equal(pruned.messages, messages)
    assert.equal(pruned.removed.size, 0)
  })
})

describe('leafAfterPrune', () => {
  it('keeps the current leaf when it was not removed', () => {
    const remaining = [msg('u1', null), msg('a1b', 'u1', 'assistant')]
    assert.equal(leafAfterPrune(remaining, new Set(['a1']), 'u1', 'a1b'), 'a1b')
  })

  it('follows the parent after deleting the active branch', () => {
    const remaining = [msg('u1', null), msg('a1b', 'u1', 'assistant')]
    assert.equal(leafAfterPrune(remaining, new Set(['a1', 'u2']), 'u1', 'u2'), 'a1b')
  })

  it('clears the leaf when the tree is empty', () => {
    assert.equal(leafAfterPrune([], new Set(['u1']), null, 'u1'), null)
  })
})

describe('regenerateActiveLeaf / forkActiveLeaf', () => {
  it('regenerates an assistant reply from its parent and a user message from itself', () => {
    assert.equal(regenerateActiveLeaf({ role: 'assistant', id: 'a1', parentId: 'u1' }), 'u1')
    assert.equal(regenerateActiveLeaf({ role: 'user', id: 'u1', parentId: null }), 'u1')
  })

  it('forks a user prompt from its parent so two prompts are never adjacent', () => {
    assert.equal(forkActiveLeaf({ role: 'user', id: 'u1', parentId: 'a0' }), 'a0')
    assert.equal(forkActiveLeaf({ role: 'user', id: 'u1', parentId: null }), ROOT_LEAF)
    assert.equal(forkActiveLeaf({ role: 'assistant', id: 'a1', parentId: 'u1' }), 'a1')
  })
})
