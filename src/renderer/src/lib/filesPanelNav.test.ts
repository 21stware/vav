import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FileEntry } from '../../../shared/types.ts'
import { entryInDir, selectionParent } from './filesPanelNav.ts'

function entry(path: string, name: string, isDirectory: boolean): FileEntry {
  return { path, name, isDirectory, size: 0, modifiedAt: 0, createdAt: 0 }
}

describe('filesPanelNav', () => {
  it('walks to the loaded parent directory, else dirname, else root', () => {
    const dirMap = {
      '/repo': [entry('/repo/src', 'src', true)],
      '/repo/src': [entry('/repo/src/a.ts', 'a.ts', false)]
    }
    assert.equal(selectionParent(null, '/repo', dirMap), '/repo')
    assert.equal(selectionParent('/repo', '/repo', dirMap), '/repo')
    assert.equal(selectionParent('/repo/src/a.ts', '/repo', dirMap), '/repo/src')
    assert.equal(selectionParent('/orphan/x', '/repo', {}), '/orphan')
  })

  it('looks up a row in a loaded column', () => {
    const dirMap = {
      '/repo': [entry('/repo/src', 'src', true)]
    }
    assert.equal(entryInDir('/repo', '/repo/src', dirMap)?.name, 'src')
    assert.equal(entryInDir('/repo', '/missing', dirMap), null)
    assert.equal(entryInDir('/repo', null, dirMap), null)
  })
})
