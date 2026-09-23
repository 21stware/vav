import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { coerceAppLibraries, EMPTY_APP_LIBRARIES } from './appFolders.ts'

describe('coerceAppLibraries', () => {
  it('returns empty libraries for junk', () => {
    assert.deepEqual(coerceAppLibraries(undefined), EMPTY_APP_LIBRARIES)
    assert.deepEqual(coerceAppLibraries('nope'), EMPTY_APP_LIBRARIES)
  })

  it('keeps folders and drops assignments to missing folders', () => {
    const next = coerceAppLibraries({
      data: {
        folders: [{ id: 'f1', name: 'Work', createdAt: 1, updatedAt: 2 }],
        assignments: { a: 'f1', b: 'gone', c: 'all' }
      }
    })
    assert.equal(next.data.folders[0]?.name, 'Work')
    assert.deepEqual(next.data.assignments, { a: 'f1' })
    assert.deepEqual(next.scheduled, { folders: [], assignments: {} })
  })
})
