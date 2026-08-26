import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { acpReadTextFile, acpWriteTextFile, resolveAcpPath } from './acpFs.ts'

describe('acpFs', () => {
  it('rejects relative paths', () => {
    assert.throws(() => resolveAcpPath('rel.txt', '/tmp'), /absolute/)
  })

  it('reads a line window and writes text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-acp-fs-'))
    const path = join(dir, 'note.txt')
    await writeFile(path, 'a\nb\nc\n', 'utf8')
    const files = {
      readTextFile: async (file: string) => ({ content: await readFile(file, 'utf8') }),
      writeTextFile: async (file: string, content: string) => {
        await writeFile(file, content, 'utf8')
        return { ok: true as const }
      }
    }
    const sliced = await acpReadTextFile(files, { path, line: 2, limit: 1 }, dir)
    assert.equal(sliced.content, 'b')
    const written = await acpWriteTextFile(files, { path, content: 'hello' }, dir)
    assert.equal(written.original, 'a\nb\nc\n')
    assert.equal(await readFile(path, 'utf8'), 'hello')
  })
})
