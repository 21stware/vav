import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { listRemoteChildEntries, listRemoteRootEntries } from './dirBrowse.ts'

describe('listRemoteRootEntries', () => {
  it('skips missing roots and dedupes', () => {
    const entries = listRemoteRootEntries(['/home', '/tmp', '/home', '/missing'], {
      exists: (path) => path !== '/missing',
      label: (path) => path
    })
    assert.deepEqual(entries, [
      { name: '/home', path: '/home' },
      { name: '/tmp', path: '/tmp' }
    ])
  })
})

describe('listRemoteChildEntries', () => {
  it('rejects paths outside roots and hides dotfiles', () => {
    const roots = ['/home/ada']
    assert.equal(listRemoteChildEntries('/etc', roots, { readdir: () => [], join: (a, b) => `${a}/${b}` }), 'forbidden')
    const listed = listRemoteChildEntries('/home/ada', roots, {
      readdir: () => [
        { name: '.git', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'src', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'README', isDirectory: () => false, isSymbolicLink: () => false }
      ],
      join: (a, b) => `${a}/${b}`
    })
    assert.deepEqual(listed, [{ name: 'src', path: '/home/ada/src' }])
  })
})
