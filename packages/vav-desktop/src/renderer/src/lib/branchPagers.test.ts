import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatMessage } from '@shared/types.ts'
import { branchPoints, ROOT_LEAF } from '@shared/thread.ts'
import { placeBranchPagers } from './branchPagers.ts'

function msg(id: string, parentId: string | null, role: ChatMessage['role']): ChatMessage {
  return { id, parentId, role, content: id, blocks: [], createdAt: 0 }
}

describe('placeBranchPagers', () => {
  const tree = [msg('u1', null, 'user'), msg('a1', 'u1', 'assistant'), msg('a2', 'u1', 'assistant')]

  it('puts a retry pager on the reply being shown, not on the prompt above it', () => {
    const placed = placeBranchPagers(branchPoints(tree, 'a2'))
    assert.equal(placed.byMessage.has('u1'), false)
    assert.deepEqual(placed.byMessage.get('a2'), { key: 'u1', index: 1, count: 2 })
    assert.equal(placed.pending, null)
  })

  it('moves the pager to the bottom while the retried reply is still being written', () => {
    const placed = placeBranchPagers(branchPoints(tree, 'u1'))
    assert.equal(placed.byMessage.size, 0)
    assert.deepEqual(placed.pending, { key: 'u1', index: 2, count: 3 })
  })

  it('puts an edited-prompt pager on the prompt itself, never above the first message', () => {
    const edited = [msg('u1', null, 'user'), msg('u1b', null, 'user'), msg('a', 'u1b', 'assistant')]
    const placed = placeBranchPagers(branchPoints(edited, 'a'))
    assert.deepEqual(placed.byMessage.get('u1b'), { key: ROOT_LEAF, index: 1, count: 2 })
    assert.equal(placed.pending, null)
  })
})
