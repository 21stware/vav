import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { DbConnectionStore } from './DbConnectionStore.ts'

function memoryVault(): {
  get: (id: string) => string | null
  set: (id: string, password: string) => void
  clear: (id: string) => void
} {
  const map = new Map<string, string>()
  return {
    get: (id) => map.get(id) ?? null,
    set: (id, password) => {
      map.set(id, password)
    },
    clear: (id) => {
      map.delete(id)
    }
  }
}

describe('DbConnectionStore', () => {
  it('persists metadata without writing the password to disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-db-'))
    const vault = memoryVault()
    const store = new DbConnectionStore(dir, vault)
    store.load()
    const created = store.create({
      title: 'Prod',
      host: 'db.internal',
      database: 'app',
      user: 'vav',
      password: 's3cret'
    })
    assert.equal(created.hasPassword, true)
    assert.equal(store.password(created.id), 's3cret')
    assert.equal(created.conversationId, null)

    const reloaded = new DbConnectionStore(dir, vault)
    reloaded.load()
    const next = reloaded.get(created.id)
    assert.equal(next?.title, 'Prod')
    assert.equal(next?.host, 'db.internal')
    assert.equal(next?.hasPassword, true)
    assert.equal(reloaded.password(created.id), 's3cret')
  })

  it('updates, marks status, and removes the vault entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-db-'))
    const vault = memoryVault()
    const store = new DbConnectionStore(dir, vault)
    const created = store.create({ conversationId: 'c1', host: 'localhost' })
    const updated = store.update(created.id, { database: 'app', password: 'pw' })
    assert.equal(updated?.database, 'app')
    assert.equal(updated?.hasPassword, true)
    const ok = store.markStatus(created.id, 'ok', null)
    assert.equal(ok?.lastStatus, 'ok')
    assert.ok(ok?.lastConnectedAt)
    assert.equal(store.getForConversation('c1')?.id, created.id)
    assert.equal(store.removeForConversation('c1'), true)
    assert.equal(store.get(created.id), undefined)
    assert.equal(store.password(created.id), null)
  })
})
