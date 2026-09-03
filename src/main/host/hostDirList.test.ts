import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mapHostDirectoryEntries } from './hostDirList.ts'

describe('mapHostDirectoryEntries', () => {
  it('keeps directories and joins with the host path helper', () => {
    const rows = mapHostDirectoryEntries(
      '/Users/ada',
      [
        { name: 'src', isDirectory: () => true },
        { name: 'README', isDirectory: () => false },
        { name: 'docs', isDirectory: () => true }
      ],
      (dir, name) => `${dir}/${name}`
    )
    assert.deepEqual(
      rows.map((r) => r.path),
      ['/Users/ada/src', '/Users/ada/docs']
    )
    assert.equal(rows[0]?.isDirectory, true)
  })
})
