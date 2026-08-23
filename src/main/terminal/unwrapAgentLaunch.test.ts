import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import { clearUnwrapCaches, unwrapAgentLaunch } from './unwrapAgentLaunch.ts'

const root = mkdtempSync(join(tmpdir(), 'vav-unwrap-'))
const grokHome = join(root, 'grok-home')
const cursorDir = join(root, 'cursor-agent')

function writeExec(path: string, body: string): void {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

beforeEach(() => {
  clearUnwrapCaches()
  process.env.GROK_HOME = grokHome
})

after(() => {
  delete process.env.GROK_HOME
  rmSync(root, { recursive: true, force: true })
})

describe('unwrapAgentLaunch grok', () => {
  it('execs ~/.grok/bin/grok when the PATH hit is the npm trampoline', () => {
    mkdirSync(join(grokHome, 'bin'), { recursive: true })
    const native = join(grokHome, 'bin', 'grok')
    const trampolineDir = join(root, 'fnm-bin')
    mkdirSync(trampolineDir, { recursive: true })
    const trampoline = join(trampolineDir, 'grok')
    writeExec(native, '#!/bin/sh\nexit 0\n')
    writeExec(trampoline, '#!/usr/bin/env node\n')
    const launch = unwrapAgentLaunch(trampoline, ['agent', 'stdio'])
    assert.equal(launch.file, native)
    assert.deepEqual(launch.args, ['agent', 'stdio'])
    assert.equal(launch.env.GROK_MANAGED_BY_NPM, '1')
  })

  it('leaves the trampoline in place when the native binary is missing', () => {
    const emptyHome = join(root, 'empty-grok-home')
    process.env.GROK_HOME = emptyHome
    const trampolineDir = join(root, 'fnm-bin-missing')
    mkdirSync(trampolineDir, { recursive: true })
    const trampoline = join(trampolineDir, 'grok')
    writeExec(trampoline, '#!/usr/bin/env node\n')
    const launch = unwrapAgentLaunch(trampoline, [])
    assert.equal(launch.file, trampoline)
    assert.deepEqual(launch.env, {})
  })

  it('is a no-op when resolve already pointed at the native binary', () => {
    mkdirSync(join(grokHome, 'bin'), { recursive: true })
    const native = join(grokHome, 'bin', 'grok')
    writeExec(native, '#!/bin/sh\nexit 0\n')
    const launch = unwrapAgentLaunch(native, ['--version'])
    assert.equal(launch.file, native)
    assert.deepEqual(launch.args, ['--version'])
    assert.deepEqual(launch.env, {})
  })
})

describe('unwrapAgentLaunch cursor', () => {
  it('skips the bash wrapper and execs bundled node + index.js', () => {
    mkdirSync(cursorDir, { recursive: true })
    const wrapper = join(cursorDir, 'cursor-agent')
    const node = join(cursorDir, 'node')
    const index = join(cursorDir, 'index.js')
    writeExec(wrapper, '#!/usr/bin/env bash\nexec node index.js "$@"\n')
    writeExec(node, '#!/bin/sh\nexit 0\n')
    writeFileSync(index, 'console.log(1)\n')
    const launch = unwrapAgentLaunch(wrapper, ['--force', '--trust'])
    assert.equal(launch.file, realpathSync(node))
    assert.ok(launch.args[0] === '--use-system-ca' || launch.args[0] === index || launch.args[0].endsWith('index.js'))
    assert.ok(launch.args.some((arg) => arg.endsWith('index.js')))
    assert.deepEqual(launch.args.slice(-2), ['--force', '--trust'])
    assert.equal(launch.env.CURSOR_INVOKED_AS, 'cursor-agent')
    assert.ok(launch.env.NODE_COMPILE_CACHE)
    assert.equal(launch.argv0, 'cursor-agent')
  })

  it('does not unwrap a lone cursor binary without the shipped node', () => {
    const lone = join(root, 'cursor')
    writeExec(lone, '#!/bin/sh\nexit 0\n')
    const launch = unwrapAgentLaunch(lone, ['acp'])
    assert.equal(launch.file, lone)
    assert.deepEqual(launch.args, ['acp'])
  })
})
