import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FileEntry } from '@shared/types'
import { canGoParent, confirmFolderPath, filterFileEntries } from './remoteFolderPick.ts'

function entry(name: string, isDirectory: boolean): FileEntry {
  return {
    path: `/Users/ada/${name}`,
    name,
    isDirectory,
    size: 0,
    modifiedAt: 0,
    createdAt: 0
  }
}

describe('remoteFolderPick', () => {
  it('confirms a selected directory rather than the listing root', () => {
    assert.equal(confirmFolderPath('/Users/ada', entry('src', true)), '/Users/ada/src')
  })

  it('keeps the listing root when a file is selected', () => {
    assert.equal(confirmFolderPath('/Users/ada', entry('README', false)), '/Users/ada')
  })

  it('keeps the listing root when nothing is selected', () => {
    assert.equal(confirmFolderPath('/Users/ada', null), '/Users/ada')
  })

  it('filters entries by name', () => {
    const rows = [entry('src', true), entry('README', false), entry('docs', true)]
    assert.deepEqual(
      filterFileEntries(rows, 're').map((row) => row.name),
      ['README']
    )
    assert.equal(filterFileEntries(rows, '  ').length, 3)
  })

  it('can leave a nested folder but not the unix root', () => {
    assert.equal(canGoParent('/Users/ada'), true)
    assert.equal(canGoParent('/'), false)
  })
})
