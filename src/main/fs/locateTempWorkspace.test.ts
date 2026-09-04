import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createLocalHostFs } from '../host/HostFs.ts'
import { locateTempWorkspaceToDir } from './locateTempWorkspace.ts'

function mintTempLayout(root: string): { container: string; workdir: string } {
  const container = join(root, 'vav', 'aabbccdd')
  const workdir = join(container, 'Workspace')
  mkdirSync(workdir, { recursive: true })
  writeFileSync(join(workdir, 'hello.md'), '# hi\n')
  writeFileSync(join(workdir, 'notes.txt'), 'keep\n')
  return { container, workdir }
}

describe('locateTempWorkspaceToDir', () => {
  it('moves the temp container so dest contains Workspace and its files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vav-locate-'))
    try {
      const { container, workdir } = mintTempLayout(root)
      const dest = join(root, 'keep')
      mkdirSync(dest)

      const result = await locateTempWorkspaceToDir({
        workdir,
        destinationDir: dest,
        platform: process.platform,
        fs: createLocalHostFs(),
        crossDeviceCopy: true
      })

      assert.deepEqual(result, { ok: true, nextWorkdir: join(dest, 'Workspace') })
      assert.equal(readFileSync(join(dest, 'Workspace', 'hello.md'), 'utf8'), '# hi\n')
      assert.equal(readFileSync(join(dest, 'Workspace', 'notes.txt'), 'utf8'), 'keep\n')
      assert.equal(
        await createLocalHostFs().exists(container),
        false,
        'empty hex container should be removed'
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('moves sibling files that live next to Workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vav-locate-'))
    try {
      const { container, workdir } = mintTempLayout(root)
      writeFileSync(join(container, 'sidecar.log'), 'log\n')
      const dest = join(root, 'keep')

      const result = await locateTempWorkspaceToDir({
        workdir,
        destinationDir: dest,
        platform: process.platform,
        fs: createLocalHostFs(),
        crossDeviceCopy: true
      })

      assert.equal(result.ok, true)
      assert.equal(readFileSync(join(dest, 'sidecar.log'), 'utf8'), 'log\n')
      assert.equal(readFileSync(join(dest, 'Workspace', 'hello.md'), 'utf8'), '# hi\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses when dest already has Workspace and leaves the temp dir in place', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vav-locate-'))
    try {
      const { workdir } = mintTempLayout(root)
      const dest = join(root, 'keep')
      mkdirSync(join(dest, 'Workspace'), { recursive: true })
      writeFileSync(join(dest, 'Workspace', 'existing.md'), 'stay\n')

      const result = await locateTempWorkspaceToDir({
        workdir,
        destinationDir: dest,
        platform: process.platform,
        fs: createLocalHostFs(),
        crossDeviceCopy: true
      })

      assert.deepEqual(result, {
        ok: false,
        error: 'exists',
        target: join(dest, 'Workspace')
      })
      assert.equal(readFileSync(join(workdir, 'hello.md'), 'utf8'), '# hi\n')
      assert.equal(readFileSync(join(dest, 'Workspace', 'existing.md'), 'utf8'), 'stay\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a non-temp workdir', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vav-locate-'))
    try {
      const project = join(root, 'repo')
      mkdirSync(project)
      const result = await locateTempWorkspaceToDir({
        workdir: project,
        destinationDir: join(root, 'keep'),
        fs: createLocalHostFs(),
        crossDeviceCopy: true
      })
      assert.deepEqual(result, { ok: false, error: 'not-temp' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
