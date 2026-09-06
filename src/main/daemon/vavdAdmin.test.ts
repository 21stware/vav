import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { existsSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createFileGrantStore } from './grants.ts'
import {
  adminFile,
  formatAdminResult,
  formatClients,
  handleAdmin,
  handleStdinLine,
  runVavdAdminCommand,
  startVavdAdmin,
  stopVavdAdmin
} from './vavdAdmin.ts'
import type { IncomingController } from '../../shared/daemonProtocol.ts'
import type { VavdAdminHandlers } from './vavdAdmin.ts'

function handlers(overrides: Partial<VavdAdminHandlers> = {}): VavdAdminHandlers {
  return {
    incoming: () => [],
    disconnect: () => false,
    unpair: () => false,
    rotateOffer: () => ({ secret: 'new-secret', pairing: 'vav-daemon://new-secret@127.0.0.1:4750?name=box' }),
    ...overrides
  }
}

const row = (id: string, name = 'Studio', state: IncomingController['state'] = 'online'): IncomingController => ({
  id,
  name,
  clientId: `c-${id}`,
  state,
  online: state === 'online',
  lastSeen: Date.now(),
  issuedAt: Date.now()
})

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
      assert.match(await runVavdAdminCommand(dir, 'disconnect', grant.id), /not running/)
      assert.match(await runVavdAdminCommand(dir, 'unpair'), /usage/)
      assert.match(await runVavdAdminCommand(dir, 'rotate-offer'), /rotated offer/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('handles stdin commands including help, rotate, and missing ids', () => {
    const rows = [row('g1')]
    let unpaired = ''
    const text = handleStdinLine('unpair g1', {
      incoming: () => rows,
      disconnect: () => false,
      unpair: (id) => {
        unpaired = id
        return true
      },
      rotateOffer: () => ({ secret: 'secret' })
    })
    assert.equal(unpaired, 'g1')
    assert.equal(text, 'ok\n')
    assert.match(formatClients(rows), /online/)
    const two: IncomingController[] = [row('a'), row('b', 'Other')]
    assert.match(formatClients(two), /2 computers are online/)
    assert.match(handleStdinLine('help', handlers()), /clients/)
    assert.match(handleStdinLine('', handlers()), /commands/)
    assert.match(handleStdinLine('unpair', handlers()), /usage/)
    assert.match(handleStdinLine('nope', handlers()), /unknown command/)
    assert.match(handleStdinLine('rotate', handlers()), /vav-daemon:/)
    assert.equal(handleStdinLine('disconnect missing', handlers()), 'not found\n')
    assert.equal(formatClients([]), 'no paired computers\n')
  })

  it('covers the JSON admin protocol', () => {
    const live = handlers({
      incoming: () => [row('g1')],
      disconnect: (id) => id === 'g1',
      unpair: (id) => id === 'g1'
    })
    assert.equal(handleAdmin({ type: 'clients' }, live).type, 'ok')
    assert.deepEqual(handleAdmin({ type: 'disconnect' }, live), { type: 'error', message: 'missing id' })
    assert.deepEqual(handleAdmin({ type: 'disconnect', id: 'g1' }, live), { type: 'ok', ok: true })
    assert.deepEqual(handleAdmin({ type: 'unpair', id: 'nope' }, live), { type: 'ok', ok: false })
    const rotated = handleAdmin({ type: 'rotate-offer' }, live)
    assert.equal(rotated.type, 'ok')
    assert.match(String(rotated.pairing), /vav-daemon:/)
    assert.match(String(handleAdmin({ type: 'wat' }, live).message), /unknown command/)
    assert.equal(formatAdminResult('rotate-offer', rotated), `${rotated.pairing}\n`)
    assert.equal(formatAdminResult('disconnect', { type: 'ok', ok: false }), 'not found\n')
    assert.equal(formatAdminResult('unpair', { type: 'error', message: 'missing id' }), 'missing id\n')
  })

  it('talks to a live admin port and prints the new pairing URI', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vavd-admin-live-'))
    const server = await startVavdAdmin(
      dir,
      handlers({
        incoming: () => [row('g1', 'Studio')],
        disconnect: (id) => id === 'g1',
        unpair: (id) => id === 'g1'
      })
    )
    try {
      const listed = await runVavdAdminCommand(dir, 'clients')
      assert.match(listed, /Studio/)
      assert.equal(await runVavdAdminCommand(dir, 'disconnect', 'g1'), 'ok\n')
      assert.equal(await runVavdAdminCommand(dir, 'unpair', 'missing'), 'not found\n')
      const rotated = await runVavdAdminCommand(dir, 'rotate-offer')
      assert.match(rotated, /^vav-daemon:/)
    } finally {
      stopVavdAdmin(dir, server)
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to disk when admin.json points at a dead port', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vavd-admin-stale-'))
    try {
      const store = createFileGrantStore(dir)
      store.issue({ clientId: 'studio', name: 'Studio' })
      const blocker = createServer()
      await new Promise<void>((resolve, reject) => {
        blocker.listen(0, '127.0.0.1', () => resolve())
        blocker.on('error', reject)
      })
      const address = blocker.address()
      const port = typeof address === 'object' && address ? address.port : 0
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
      writeFileSync(adminFile(dir), JSON.stringify({ port }))
      const listed = await runVavdAdminCommand(dir, 'clients')
      assert.match(listed, /Studio/)
      assert.equal(existsSync(adminFile(dir)), false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
