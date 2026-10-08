import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { filePathStatus } from './FileSessionStore.ts'

describe('filePathStatus', () => {
  it('reports a real file as ok and a folder as directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'vav-path-status-'))
    const file = join(root, 'note.md')
    const folder = join(root, 'docs')
    writeFileSync(file, 'hi')
    mkdirSync(folder)
    try {
      assert.equal(filePathStatus(file), 'ok')
      assert.equal(filePathStatus(folder), 'directory')
      assert.equal(filePathStatus(join(root, 'missing.md')), 'file_missing')
      assert.equal(filePathStatus(join(root, 'gone', 'missing.md')), 'dir_missing')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
