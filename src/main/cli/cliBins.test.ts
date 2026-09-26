import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import {
  CLI_BIN_NAMES,
  findCliSource,
  nodeBinLauncherScript,
  resolveNodeBinSpec
} from './cliBins.ts'

describe('cliBins', () => {
  it('installs vav plus vav-server', () => {
    assert.deepEqual([...CLI_BIN_NAMES], ['vav', 'vav-server'])
  })

  it('writes a shim that points at vav-server state and the bundled script', () => {
    const script = nodeBinLauncherScript({
      name: 'vav-server',
      execPath: '/usr/bin/node',
      asNode: false,
      scriptPath: '/app/Resources/vav-server/vav-server.js',
      extraNodeArgs: [],
      stateDir: '/Users/me/Library/Application Support/vav/vav-server'
    })
    assert.match(script, /^#!\/bin\/sh/)
    assert.match(script, /VAV_SERVER_STATE=/)
    assert.match(script, /vav-server\.js/)
    assert.match(script, /exec "\$BIN"/)
    assert.doesNotMatch(script, /ELECTRON_RUN_AS_NODE/)
  })

  it('marks Electron-as-Node shims', () => {
    const script = nodeBinLauncherScript({
      name: 'vav-server',
      execPath: '/Applications/VAV.app/Contents/MacOS/VAV',
      asNode: true,
      scriptPath: '/Applications/VAV.app/Contents/Resources/vav-server/vav-server.js',
      extraNodeArgs: [],
      stateDir: '/tmp/vav-server'
    })
    assert.match(script, /ELECTRON_RUN_AS_NODE=1/)
  })

  it('finds source entries from the repo root', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
    assert.ok(findCliSource('vav-server', root)?.endsWith('vav-server.ts'))
    const spec = resolveNodeBinSpec('vav-server', { cwd: root, stateDir: '/tmp/vav-server' })
    assert.ok(spec)
    assert.ok(spec.scriptPath.endsWith('vav-server.ts'))
    assert.ok(spec.extraNodeArgs.includes('--experimental-strip-types'))
  })
})
