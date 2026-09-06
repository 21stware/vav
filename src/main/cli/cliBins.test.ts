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
    assert.deepEqual([...CLI_BIN_NAMES], ['vav', 'vavd', 'vavc', 'vavcli'])
  })

  it('writes a shim that points at vavd state and the bundled script', () => {
    const script = nodeBinLauncherScript({
      name: 'vavc',
      execPath: '/usr/bin/node',
      asNode: false,
      scriptPath: '/app/Resources/vavd/vavc.js',
      extraNodeArgs: [],
      stateDir: '/Users/me/Library/Application Support/vav/vavd'
    })
    assert.match(script, /^#!\/bin\/sh/)
    assert.match(script, /VAVD_STATE=/)
    assert.match(script, /vavc\.js/)
    assert.match(script, /exec "\$BIN"/)
    assert.doesNotMatch(script, /ELECTRON_RUN_AS_NODE/)
  })

  it('marks Electron-as-Node shims', () => {
    const script = nodeBinLauncherScript({
      name: 'vavd',
      execPath: '/Applications/VAV.app/Contents/MacOS/VAV',
      asNode: true,
      scriptPath: '/Applications/VAV.app/Contents/Resources/vavd/vavd.js',
      extraNodeArgs: [],
      stateDir: '/tmp/vavd'
    })
    assert.match(script, /ELECTRON_RUN_AS_NODE=1/)
  })

  it('finds source entries from the repo root', () => {
    const root = joinRepo()
    assert.ok(findCliSource('vavc', root)?.endsWith('vavc.ts'))
    assert.ok(findCliSource('vavcli', root)?.endsWith('vavcli.ts'))
    const spec = resolveNodeBinSpec('vavc', { cwd: root, stateDir: '/tmp/vavd' })
    assert.ok(spec)
    assert.ok(spec.scriptPath.endsWith('vavc.ts'))
    assert.ok(spec.extraNodeArgs.includes('--experimental-strip-types'))
  })
})

function joinRepo(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../..')
}
