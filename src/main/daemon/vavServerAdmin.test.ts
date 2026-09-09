import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createFileGrantStore } from './grants.ts'
import {
  adminHandlersFor,
  formatClients,
  handleStdinLine,
  runVavServerAdminCommand,
  startVavServerAdmin,
  stopVavServerAdmin
} from './vavServerAdmin.ts'
import type { IncomingController } from '../../shared/daemonProtocol.ts'
import type { DaemonServer } from './DaemonServer.ts'

describe('vav-server admin', () => {
  it('lists and unpairs grants offline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-server-admin-'))
    try {
      const store = createFileGrantStore(dir)
      const grant = store.issue({ clientId: 'studio', name: 'Studio' })
      const listed = await runVavServerAdminCommand(dir, 'clients')
      assert.match(listed, /Studio/)
      assert.match(listed, /offline/)
      const removed = await runVavServerAdminCommand(dir, 'unpair', grant.id)
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
    assert.match(handleStdinLine('help', { incoming: () => [], disconnect: () => false, unpair: () => false, rotateOffer: () => '' }), /commands:/)
    assert.match(handleStdinLine('nope', { incoming: () => [], disconnect: () => false, unpair: () => false, rotateOffer: () => '' }), /unknown command/)
    assert.match(handleStdinLine('disconnect', { incoming: () => [], disconnect: () => false, unpair: () => false, rotateOffer: () => '' }), /usage:/)
    let rotated = false
    assert.equal(
      handleStdinLine('rotate', {
        incoming: () => [],
        disconnect: () => false,
        unpair: () => false,
        rotateOffer: () => {
          rotated = true
          return 'secret'
        }
      }),
      'rotated offer\n'
    )
    assert.equal(rotated, true)
    assert.equal(
      handleStdinLine('disconnect missing', {
        incoming: () => [],
        disconnect: () => false,
        unpair: () => false,
        rotateOffer: () => ''
      }),
      'not found\n'
    )
  })

  it('edits grants offline when vav-server is not listening', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-server-admin-off-'))
    try {
      assert.equal(await runVavServerAdminCommand(dir, 'disconnect', 'g1'), 'vav-server is not running — nothing to disconnect.\n')
      assert.equal(await runVavServerAdminCommand(dir, 'unpair'), 'usage: vav-server unpair <grant-id>\n')
      assert.match(await runVavServerAdminCommand(dir, 'unpair', 'missing'), /no grant/)
      assert.match(await runVavServerAdminCommand(dir, 'rotate-offer'), /rotated offer/)
      const store = createFileGrantStore(dir)
      const grant = store.issue({ clientId: 'box', name: 'Build' })
      assert.match(await runVavServerAdminCommand(dir, 'unpair', 'Build'), /unpaired Build/)
      assert.equal(createFileGrantStore(dir).findById(grant.id), null)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('talks to a live admin socket', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-server-admin-live-'))
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
    let disconnected = ''
    let unpaired = ''
    const server = await startVavServerAdmin(dir, {
      incoming: () => rows,
      disconnect: (id) => {
        disconnected = id
        return id === 'g1'
      },
      unpair: (id) => {
        unpaired = id
        return id === 'g1'
      },
      rotateOffer: () => 'new-secret'
    })
    try {
      assert.match(await runVavServerAdminCommand(dir, 'clients'), /Studio/)
      assert.equal(await runVavServerAdminCommand(dir, 'disconnect', 'g1'), 'ok\n')
      assert.equal(disconnected, 'g1')
      assert.equal(await runVavServerAdminCommand(dir, 'unpair', 'g1'), 'ok\n')
      assert.equal(unpaired, 'g1')
      assert.match(await runVavServerAdminCommand(dir, 'rotate-offer'), /rotated offer/)
      assert.equal(await runVavServerAdminCommand(dir, 'disconnect', 'missing'), 'not found\n')
    } finally {
      stopVavServerAdmin(dir, server)
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('resolves grants by name for a running daemon', () => {
    const incoming: IncomingController[] = [
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
    let disconnected = ''
    let unpaired = ''
    const handlers = adminHandlersFor(
      {
        incoming: () => incoming,
        disconnectGrant: (id: string) => {
          disconnected = id
          return id === 'g1'
        },
        unpairGrant: (id: string) => {
          unpaired = id
          return id === 'g1'
        }
      } as unknown as DaemonServer,
      () => 'secret'
    )
    assert.equal(handlers.disconnect('Studio'), true)
    assert.equal(disconnected, 'g1')
    assert.equal(handlers.unpair('g1'), true)
    assert.equal(unpaired, 'g1')
    assert.equal(handlers.unpair('missing'), false)
  })
})
