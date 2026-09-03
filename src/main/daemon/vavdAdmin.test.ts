import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createFileGrantStore } from './grants.ts'
import { formatClients, handleStdinLine, runVavdAdminCommand } from './vavdAdmin.ts'
import type { IncomingController } from '../../shared/daemonProtocol.ts'

describe('vavd admin', () => {
  it('lists and unpairs grants offline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vavd-admin-'))
    try {
      const store = createFileGrantStore(dir)
      const grant = store.issue({ clientId: 'studio', name: 'Studio' })
      const listed = await runVavdAdminCommand(dir, 'clients')
      assert.match(listed, /Studio/)
      assert.match(listed, /offline/)
      const removed = await runVavdAdminCommand(dir, 'unpair', grant.id)
      assert.match(removed, /unpaired/)
      assert.equal(createFileGrantStore(dir).list().length, 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('handles stdin commands', () => {
    const rows: IncomingController[] = [
      {
        id: 'g1',
        name: 'Studio',
        clientId: 'c1',
        state: 'online',
        online: true,
        lastSeen: Date.now(),
        issuedAt: Date.now()
      }
    ]
    let unpaired = ''
    const text = handleStdinLine('unpair g1', {
      incoming: () => rows,
      disconnect: () => false,
      unpair: (id) => {
        unpaired = id
        return true
      },
      rotateOffer: () => 'secret'
    })
    assert.equal(unpaired, 'g1')
    assert.equal(text, 'ok\n')
    assert.match(formatClients(rows), /online/)
    const two: IncomingController[] = [
      { ...rows[0], id: 'a', state: 'online', online: true },
      { ...rows[0], id: 'b', name: 'Other', state: 'online', online: true }
    ]
    assert.match(formatClients(two), /2 computers are online/)
  })
})
