import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mapHostDirectoryEntries } from './hostDirList.ts'

describe('mapHostDirectoryEntries', () => {
  it('keeps files and folders, folders first, joined with the host path helper', () => {
    const rows = mapHostDirectoryEntries(
      '/Users/ada',
      [
        { name: 'src', isDirectory: () => true },
        { name: 'README', isDirectory: () => false },
        { name: 'docs', isDirectory: () => true },
        { name: '.DS_Store', isDirectory: () => false },
        { name: 'node_modules', isDirectory: () => true }
      ],
      (dir, name) => `${dir}/${name}`
    )
    assert.deepEqual(
      rows.map((r) => r.path),
      ['/Users/ada/docs', '/Users/ada/src', '/Users/ada/README']
    )
    assert.equal(rows[0]?.isDirectory, true)
    assert.equal(rows[2]?.isDirectory, false)
  })
})
