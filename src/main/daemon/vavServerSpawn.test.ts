import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findVavServerEntry,
  findVavServerScript,
  resolveNodeForVavServer,
  spawnLocalVavServer,
  vavServerNodeArgs
} from './vavServerSpawn.ts'
import { parseDaemonPairing } from '../../shared/daemonProtocol.ts'

describe('spawnLocalVavServer', () => {
  it('finds vav-server.ts from the repo root', () => {
    const script = findVavServerScript()
    assert.ok(script?.endsWith('vav-server.ts'))
    const entry = findVavServerEntry()
    assert.equal(entry?.kind, 'source')
    assert.ok(entry?.path.endsWith('vav-server.ts'))
  })

  it('prefers a packaged extraResources bundle when source is absent', () => {
    const resources = mkdtempSync(join(tmpdir(), 'vav-server-res-'))
    try {
      mkdirSync(join(resources, 'vav-server'), { recursive: true })
      writeFileSync(join(resources, 'vav-server', 'vav-server.js'), '#!/usr/bin/env node\n')
      const empty = mkdtempSync(join(tmpdir(), 'vav-server-empty-'))
      const entry = findVavServerEntry(empty, resources)
      assert.equal(entry?.kind, 'bundle')
      assert.equal(entry?.path, join(resources, 'vav-server', 'vav-server.js'))
      assert.deepEqual(vavServerNodeArgs(entry, ['--help']), [entry.path, '--help'])
      rmSync(empty, { recursive: true, force: true })
    } finally {
      rmSync(resources, { recursive: true, force: true })
    }
  })

  it('does not use the Electron binary as Node when a node path is set', () => {
    const resolved = resolveNodeForVavServer(
      { npm_node_execpath: process.execPath },
      { electron: '37.0.0' }
    )
    assert.equal(resolved.cmd, process.execPath)
    assert.equal(resolved.asNode, false)
    assert.equal(resolveNodeForVavServer({}, { electron: '37.0.0' }).asNode, true)
    assert.equal(resolveNodeForVavServer({}, {}).asNode, false)
  })

  it('prints a pairing URI the desktop can attach to', async () => {
    const spawned = await spawnLocalVavServer({ name: 'Spawn Test', stubTurn: true })
    try {
      const parsed = parseDaemonPairing(spawned.pairing)
      assert.ok(parsed)
      assert.equal(parsed?.name, 'Spawn Test')
      assert.equal(spawned.machineId, parsed?.machineId)
    } finally {
      spawned.stop()
    }
  })

  it('exposes the web bridge the Chrome extension discovers', async () => {
    const spawned = await spawnLocalVavServer({
      name: 'Desktop Web',
      stubTurn: true,
      noWeb: false,
      webPort: 0
    })
    try {
      assert.ok(spawned.webOrigin)
      const res = await fetch(`${spawned.webOrigin}/discover`)
      assert.equal(res.ok, true)
      const info = (await res.json()) as { app?: string; secret?: string; wsPath?: string }
      assert.equal(info.app, 'vav-server')
      assert.ok(info.secret)
      assert.equal(info.wsPath, '/vav')
    } finally {
      spawned.stop()
    }
  })
})
