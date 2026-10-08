import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore, folderDefinitelyGone } from './SettingsStore.ts'

describe('SettingsStore recent working folders', () => {
  it('treats only ENOENT as gone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-recent-'))
    assert.equal(folderDefinitelyGone(dir), false)
    assert.equal(folderDefinitelyGone(join(dir, 'missing')), true)
    // Unmounted volume: keep the ref until the drive comes back.
    assert.equal(folderDefinitelyGone('/Volumes/__vav_not_mounted__/proj'), false)
  })

  it('does not drop a folder that disappears between updates', () => {
    const root = mkdtempSync(join(tmpdir(), 'vav-recent-'))
    const work = join(root, 'proj')
    mkdirSync(work)
    const store = new SettingsStore(join(root, 'user'))
    store.load()
    store.rememberWorkspaceDirectory(work, '')
    rmSync(work, { recursive: true })
    store.update({ defaultModel: 'x' })
    assert.deepEqual(
      store.get().recentWorkspaceDirectories.map((ref) => ref.path),
      [work]
    )
  })
})
