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
  it('installs vav plus the three daemon commands', () => {
    assert.deepEqual([...CLI_BIN_NAMES], ['vav', 'vav-server', 'vav-board', 'vav-tui'])
  })

  it('writes a shim that points at vav-server state and the bundled script', () => {
    const script = nodeBinLauncherScript({
      name: 'vav-board',
      execPath: '/usr/bin/node',
      asNode: false,
      scriptPath: '/app/Resources/vav-server/vav-board.js',
      extraNodeArgs: [],
      stateDir: '/Users/me/Library/Application Support/vav/vav-server'
    })
    assert.match(script, /^#!\/bin\/sh/)
    assert.match(script, /VAV_SERVER_STATE=/)
    assert.match(script, /vav-board\.js/)
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
    const root = joinRepo()
    assert.ok(findCliSource('vav-board', root)?.endsWith('vav-board.ts'))
    assert.ok(findCliSource('vav-tui', root)?.endsWith('vav-tui.ts'))
    const spec = resolveNodeBinSpec('vav-board', { cwd: root, stateDir: '/tmp/vav-server' })
    assert.ok(spec)
    assert.ok(spec.scriptPath.endsWith('vav-board.ts'))
    assert.ok(spec.extraNodeArgs.includes('--experimental-strip-types'))
  })
})

function joinRepo(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../..')
}
