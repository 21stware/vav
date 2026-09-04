import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findVavdScript, spawnLocalVavd } from './vavdSpawn.ts'
import { parseDaemonPairing } from '../../shared/daemonProtocol.ts'

describe('spawnLocalVavd', () => {
  it('finds vavd.ts from the repo root', () => {
    const script = findVavdScript()
    assert.ok(script?.endsWith('vavd.ts'))
  })

  it('prints a pairing URI the desktop can attach to', async () => {
    const spawned = await spawnLocalVavd({ name: 'Spawn Test', stubTurn: true })
    try {
      const parsed = parseDaemonPairing(spawned.pairing)
      assert.ok(parsed)
      assert.equal(parsed?.name, 'Spawn Test')
      assert.equal(spawned.machineId, parsed?.machineId)
    } finally {
      spawned.stop()
    }
  })
})
