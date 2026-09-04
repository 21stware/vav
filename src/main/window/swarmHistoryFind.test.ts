import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findSwarmHistoryItem } from './swarmHistoryFind.ts'

describe('findSwarmHistoryItem', () => {
  it('returns the matching item across groups, or null', () => {
    const groups = [
      { items: [{ id: 'a', title: 'A' }] },
      { items: [{ id: 'b', title: 'B' }, { id: 'c', title: 'C' }] }
    ]
    assert.deepEqual(findSwarmHistoryItem(groups, 'b'), { id: 'b', title: 'B' })
    assert.equal(findSwarmHistoryItem(groups, 'missing'), null)
    assert.equal(findSwarmHistoryItem(null, 'a'), null)
    assert.equal(findSwarmHistoryItem(undefined, 'a'), null)
  })
})
