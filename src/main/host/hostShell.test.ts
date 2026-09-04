import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hostDirname, openSpawn, previewSpawn, revealSpawn } from './hostShell.ts'

describe('hostShell', () => {
  it('reveals in Finder on darwin and Explorer on Windows', () => {
    assert.deepEqual(revealSpawn('darwin', '/Users/me/note.md', false), {
      file: 'open',
      args: ['-R', '/Users/me/note.md']
    })
    assert.deepEqual(revealSpawn('win32', 'C:\\proj\\a.txt', false), {
      file: 'explorer.exe',
      args: ['/select,C:\\proj\\a.txt']
    })
  })

  it('reveals a Linux file by opening its parent folder', () => {
    assert.deepEqual(revealSpawn('linux', '/srv/app/host-only.md', false), {
      file: 'xdg-open',
      args: ['/srv/app']
    })
    assert.deepEqual(revealSpawn('linux', '/srv/app', true), {
      file: 'xdg-open',
      args: ['/srv/app']
    })
  })

  it('opens with the host default app', () => {
    assert.deepEqual(openSpawn('darwin', '/tmp/a.md'), { file: 'open', args: ['/tmp/a.md'] })
    assert.deepEqual(openSpawn('linux', '/tmp/a.md'), { file: 'xdg-open', args: ['/tmp/a.md'] })
  })

  it('previews with Quick Look on darwin', () => {
    assert.deepEqual(previewSpawn('darwin', '/tmp/a.md'), {
      file: 'qlmanage',
      args: ['-p', '/tmp/a.md']
    })
    assert.deepEqual(previewSpawn('linux', '/tmp/a.md'), {
      file: 'xdg-open',
      args: ['/tmp/a.md']
    })
  })

  it('dirnames with the host separator', () => {
    assert.equal(hostDirname('linux', '/a/b/c'), '/a/b')
    assert.equal(hostDirname('win32', 'C:\\a\\b.txt'), 'C:\\a')
  })
})
