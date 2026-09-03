import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { capVisibleEntries, directoryFileEntry, directoryListingError } from './fileEntrySort.ts'

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

describe('directoryListingError / directoryFileEntry', () => {
  it('returns an empty listing with the error and stamps expandable folders', () => {
    assert.deepEqual(directoryListingError('/proj', 'denied'), {
      path: '/proj',
      entries: [],
      truncated: 0,
      error: 'denied'
    })
    assert.equal(
      directoryFileEntry({
        path: '/proj/src',
        name: 'src',
        isDirectory: true,
        size: 0,
        modifiedAt: 1,
        createdAt: 2
      }).children,
      null
    )
    assert.equal(
      directoryFileEntry({
        path: '/proj/a.ts',
        name: 'a.ts',
        isDirectory: false,
        size: 9,
        modifiedAt: 1,
        createdAt: 2
      }).children,
      undefined
    )
  })
})
