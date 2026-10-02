import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { FileService } from './FileService.ts'

describe('FileService.inspect directories', () => {
  it('classifies a folder even when the path is not granted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vav-inspect-dir-'))
    const folder = join(root, 'docs')
    mkdirSync(folder)
    const files = new FileService(() => {})
    try {
      const info = await files.inspect(folder)
      assert.equal(info.kind, 'directory')
      assert.equal(info.path, folder)
      assert.equal(info.error, undefined)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('still denies an ungranted file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vav-inspect-file-'))
    const file = join(root, 'secret.md')
    writeFileSync(file, 'nope')
    const files = new FileService(() => {})
    try {
      const info = await files.inspect(file)
      assert.equal(info.kind, 'binary')
      assert.ok(info.error)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
