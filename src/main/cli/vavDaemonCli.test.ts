import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultShell } from './vavDaemonCli.ts'

describe('vavDaemonCli', () => {
  it('picks a real login shell for pane spawn', () => {
    const shell = defaultShell()
    if (process.platform === 'win32') {
      assert.match(shell, /powershell|cmd|COMSPEC/i)
    } else {
      assert.match(shell, /\/(zsh|bash|sh|fish)$/)
    }
  })
})
