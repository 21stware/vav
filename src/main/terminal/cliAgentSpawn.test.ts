import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isAbsoluteExecutable, planCliAgentSpawn } from './cliAgentSpawn.ts'

describe('isAbsoluteExecutable', () => {
  it('accepts unix and windows paths', () => {
    assert.equal(isAbsoluteExecutable('/opt/homebrew/bin/claude'), true)
    assert.equal(isAbsoluteExecutable('C:\\Users\\me\\claude.exe'), true)
    assert.equal(isAbsoluteExecutable('claude'), false)
    assert.equal(isAbsoluteExecutable(''), false)
  })
})

describe('planCliAgentSpawn', () => {
  it('execs an absolute path directly on macOS', () => {
    const planned = planCliAgentSpawn({
      resolved: '/opt/homebrew/bin/claude',
      agentArgs: ['--dangerously-skip-permissions'],
      shell: '/bin/zsh',
      isWindows: false
    })
    assert.deepEqual(planned, {
      file: '/opt/homebrew/bin/claude',
      args: ['--dangerously-skip-permissions']
    })
  })

  it('wraps a bare name in a login shell so nvm/fnm still resolve', () => {
    const planned = planCliAgentSpawn({
      resolved: 'claude',
      agentArgs: ['--resume', 'abc'],
      shell: '/bin/zsh',
      isWindows: false
    })
    assert.equal(planned.file, '/bin/zsh')
    assert.deepEqual(planned.args, ['-ilc', `exec 'claude' '--resume' 'abc'`])
  })

  it('never wraps on Windows', () => {
    const planned = planCliAgentSpawn({
      resolved: 'claude',
      agentArgs: [],
      shell: 'powershell.exe',
      isWindows: true
    })
    assert.deepEqual(planned, { file: 'claude', args: [] })
  })
})
