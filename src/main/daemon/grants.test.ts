import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  createFileGrantStore,
  createMemoryGrantStore,
  incomingFromGrants,
  isPairAuthMessage,
  isPairRevokedMessage
} from './grants.ts'

describe('grant store', () => {
  it('issues a unique secret and replaces the same client', () => {
    const store = createMemoryGrantStore()
    const first = store.issue({ clientId: 'laptop', name: 'Studio' })
    const second = store.issue({ clientId: 'laptop', name: 'Studio 2' })
    assert.notEqual(first.id, second.id)
    assert.notEqual(first.secret, second.secret)
    assert.equal(store.list().length, 1)
    assert.equal(store.findById(first.id), null)
    assert.equal(store.findBySecret(second.secret)?.name, 'Studio 2')
  })

  it('finds by secret without treating names as identity', () => {
    const store = createMemoryGrantStore()
    const a = store.issue({ clientId: 'a', name: 'Mac' })
    const b = store.issue({ clientId: 'b', name: 'Mac' })
    assert.equal(store.findBySecret(a.secret)?.id, a.id)
    assert.equal(store.findBySecret(b.secret)?.id, b.id)
    assert.equal(store.findBySecret('not-a-real-grant-secret'), null)
  })

  it('persists across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-grants-'))
    try {
      const first = createFileGrantStore(dir)
      const issued = first.issue({ clientId: 'box', name: 'Build' })
      const again = createFileGrantStore(dir)
      assert.equal(again.findById(issued.id)?.secret, issued.secret)
      again.remove(issued.id)
      const raw = JSON.parse(await readFile(join(dir, 'grants.json'), 'utf8')) as { grants: unknown[] }
      assert.equal(raw.grants.length, 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('marks online controllers from live grant ids', () => {
    const store = createMemoryGrantStore()
    const live = store.issue({ clientId: 'a', name: 'One' })
    const idle = store.issue({ clientId: 'b', name: 'Two' })
    const incoming = incomingFromGrants(store.list(), new Set([live.id]))
    assert.equal(incoming.find((row) => row.id === live.id)?.online, true)
    assert.equal(incoming.find((row) => row.id === idle.id)?.online, false)
  })
})

describe('pair error text', () => {
  it('classifies revoked vs generic auth', () => {
    assert.equal(isPairRevokedMessage('pairing revoked'), true)
    assert.equal(isPairAuthMessage('pairing rejected'), true)
    assert.equal(isPairAuthMessage('pairing revoked'), true)
    assert.equal(isPairRevokedMessage('ECONNREFUSED'), false)
  })
})
