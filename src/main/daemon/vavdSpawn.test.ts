import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findVavdScript, resolveNodeForVavd, spawnLocalVavd } from './vavdSpawn.ts'
import { parseDaemonPairing } from '../../shared/daemonProtocol.ts'

describe('spawnLocalVavd', () => {
  it('finds vavd.ts from the repo root', () => {
    const script = findVavdScript()
    assert.ok(script?.endsWith('vavd.ts'))
  })

  it('does not use the Electron binary as Node when a node path is set', () => {
    const resolved = resolveNodeForVavd(
      { npm_node_execpath: process.execPath },
      { electron: '37.0.0' }
    )
    assert.equal(resolved.cmd, process.execPath)
    assert.equal(resolved.asNode, false)
    assert.equal(resolveNodeForVavd({}, { electron: '37.0.0' }).cmd, 'node')
    assert.equal(resolveNodeForVavd({}, {}).asNode, false)
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
