import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { capVisibleEntries } from './fileEntrySort.ts'

describe('capVisibleEntries', () => {
  it('slices to the cap and reports overflow', () => {
    assert.deepEqual(capVisibleEntries(['a', 'b', 'c'], 2), {
      slice: ['a', 'b'],
      truncated: 1
    })
    assert.deepEqual(capVisibleEntries(['a'], 10), { slice: ['a'], truncated: 0 })
    assert.deepEqual(capVisibleEntries([], 5), { slice: [], truncated: 0 })
  })
})
