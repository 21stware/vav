import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  it('issues unique secrets per client and reuses the grant when the same client pairs again', () => {
    const store = createMemoryGrantStore()
    const first = store.issue({ clientId: 'laptop', name: 'Studio' })
    const other = store.issue({ clientId: 'desk', name: 'Studio' })
    assert.notEqual(first.secret, other.secret)
    store.markKicked(first.id)
    // Re-pair / LAN+tunnel race: both connections must end up holding a valid grant.
    const second = store.issue({ clientId: 'laptop', name: 'Studio 2' })
    assert.equal(second.id, first.id)
    assert.equal(second.secret, first.secret)
    assert.equal(second.kicked, false)
    assert.equal(store.list().length, 2)
    assert.equal(store.findBySecret(first.secret)?.name, 'Studio 2')
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

  it('tombstones removed grants and persists them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-grants-'))
    try {
      const store = createFileGrantStore(dir)
      const gone = store.issue({ clientId: 'a', name: 'A' })
      const kept = store.issue({ clientId: 'b', name: 'B' })
      store.issue({ clientId: 'b', name: 'B again' })
      store.remove(gone.id)
      assert.equal(store.isRevoked(gone.id), true)
      // Re-pair of the same client is not a revoke.
      assert.equal(store.isRevoked(kept.id), false)
      assert.equal(store.isRevoked(''), false)
      const again = createFileGrantStore(dir)
      assert.equal(again.isRevoked(gone.id), true)
      assert.deepEqual(again.revokedIds(), [gone.id])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('caps tombstones', () => {
    const store = createMemoryGrantStore()
    const first = store.issue({ clientId: 'c0', name: 'x' })
    store.remove(first.id)
    for (let i = 1; i <= 300; i += 1) {
      const grant = store.issue({ clientId: `c${i}`, name: 'x' })
      store.remove(grant.id)
    }
    assert.equal(store.revokedIds().length, 256)
    assert.equal(store.isRevoked(first.id), false)
  })

  it('finds by client id and clears kicked on touch', () => {
    const store = createMemoryGrantStore()
    const grant = store.issue({ clientId: 'laptop', name: 'Studio' })
    assert.equal(store.findByClientId('laptop')?.id, grant.id)
    assert.equal(store.findByClientId(''), null)
    store.markKicked(grant.id)
    store.touch(grant.id, 'Studio 2')
    assert.equal(store.findById(grant.id)?.name, 'Studio 2')
    assert.equal(store.findById(grant.id)?.kicked, false)
  })

  it('ignores a corrupt grants file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-grants-bad-'))
    try {
      await writeFile(join(dir, 'grants.json'), '{not json')
      assert.equal(createFileGrantStore(dir).list().length, 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('marks online controllers from live grant ids', () => {
    const store = createMemoryGrantStore()
    const live = store.issue({ clientId: 'a', name: 'One' })
    const idle = store.issue({ clientId: 'b', name: 'Two' })
    const incoming = incomingFromGrants(store.list(), new Set([live.id]))
    assert.equal(incoming.find((row) => row.id === live.id)?.state, 'online')
    assert.equal(incoming.find((row) => row.id === idle.id)?.state, 'offline')
    store.markKicked(idle.id)
    const kicked = incomingFromGrants(store.list(), new Set())
    assert.equal(kicked.find((row) => row.id === idle.id)?.state, 'kicked')
    const revoked: import('../../shared/daemonProtocol.ts').IncomingController = {
      id: 'gone',
      name: 'Gone',
      clientId: 'x',
      state: 'revoked',
      online: false,
      lastSeen: Date.now(),
      issuedAt: Date.now()
    }
    assert.equal(incomingFromGrants([], new Set(), [revoked])[0]?.state, 'revoked')
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
