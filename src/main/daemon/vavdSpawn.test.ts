import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findVavdEntry,
  findVavdScript,
  resolveNodeForVavd,
  spawnLocalVavd,
  vavdNodeArgs
} from './vavdSpawn.ts'
import { parseDaemonPairing } from '../../shared/daemonProtocol.ts'

describe('spawnLocalVavd', () => {
  it('finds vavd.ts from the repo root', () => {
    const script = findVavdScript()
    assert.ok(script?.endsWith('vavd.ts'))
    const entry = findVavdEntry()
    assert.equal(entry?.kind, 'source')
    assert.ok(entry?.path.endsWith('vavd.ts'))
  })

  it('prefers a packaged extraResources bundle when source is absent', () => {
    const resources = mkdtempSync(join(tmpdir(), 'vavd-res-'))
    try {
      mkdirSync(join(resources, 'vavd'), { recursive: true })
      writeFileSync(join(resources, 'vavd', 'vavd.js'), '#!/usr/bin/env node\n')
      const empty = mkdtempSync(join(tmpdir(), 'vavd-empty-'))
      const entry = findVavdEntry(empty, resources)
      assert.equal(entry?.kind, 'bundle')
      assert.equal(entry?.path, join(resources, 'vavd', 'vavd.js'))
      assert.deepEqual(vavdNodeArgs(entry, ['--help']), [entry.path, '--help'])
      rmSync(empty, { recursive: true, force: true })
    } finally {
      rmSync(resources, { recursive: true, force: true })
    }
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
