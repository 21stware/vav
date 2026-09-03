import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { loadOrCreateIdentity, loadOrCreateSecret, persistSecret, writePrivateJson } from './identity.ts'

describe('daemon identity', () => {
  it('reuses a persisted machine id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-id-'))
    try {
      const first = loadOrCreateIdentity(dir, 'Alpha')
      const again = loadOrCreateIdentity(dir)
      assert.equal(again.machineId, first.machineId)
      assert.equal(first.name, 'Alpha')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('renames when a new display name is passed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-id-'))
    try {
      const first = loadOrCreateIdentity(dir, 'Old')
      const next = loadOrCreateIdentity(dir, 'New')
      assert.equal(next.machineId, first.machineId)
      assert.equal(next.name, 'New')
      const raw = JSON.parse(await readFile(join(dir, 'identity.json'), 'utf8')) as { name: string }
      assert.equal(raw.name, 'New')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps a secret across reloads and honors persistSecret', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-sec-'))
    try {
      const first = loadOrCreateSecret(dir)
      assert.ok(first.length >= 16)
      assert.equal(loadOrCreateSecret(dir), first)
      persistSecret(dir, '0123456789abcdef0123')
      assert.equal(loadOrCreateSecret(dir), '0123456789abcdef0123')
      if (process.platform !== 'win32') {
        const { stat } = await import('node:fs/promises')
        const mode = (await stat(join(dir, 'secret.json'))).mode & 0o777
        assert.equal(mode, 0o600)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writePrivateJson restricts mode on POSIX', async () => {
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'vav-mode-'))
    try {
      const file = join(dir, 'secret.json')
      writePrivateJson(file, { secret: 'x' })
      const { stat } = await import('node:fs/promises')
      assert.equal((await stat(file)).mode & 0o777, 0o600)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
