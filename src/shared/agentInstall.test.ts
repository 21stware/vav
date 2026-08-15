import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  INSTALL_LOG_MAX_CHARS,
  installLogLine,
  nonInteractiveInstallEnv,
  stripAnsi
} from './agentInstall.ts'

describe('installLogLine', () => {
  it('keeps the last printable segment of a chunk', () => {
    assert.equal(installLogLine('', 'downloading\nunpacking\nlinking\n'), 'linking')
  })

  it('follows carriage-return progress bars like a terminal would', () => {
    assert.equal(installLogLine('', '  1%\r 42%\r100%\r'), '100%')
  })

  it('strips ansi colour and collapses whitespace', () => {
    assert.equal(installLogLine('', '\u001b[32m  ok   done \u001b[0m\n'), 'ok done')
  })

  it('keeps the previous line when a chunk has no printable text', () => {
    assert.equal(installLogLine('installing', '\n\r  \u001b[2K'), 'installing')
  })

  it('truncates very long lines', () => {
    const line = installLogLine('', `${'x'.repeat(400)}\n`)
    assert.equal(line.length, INSTALL_LOG_MAX_CHARS)
    assert.ok(line.endsWith('…'))
  })
})

describe('stripAnsi', () => {
  it('removes escape sequences and control bytes', () => {
    assert.equal(stripAnsi('\u001b[1mbold\u001b[0m\u0007'), 'bold')
  })
})

describe('nonInteractiveInstallEnv', () => {
  const overrides = { path: '/opt/bin:/usr/bin', home: '/Users/me', shell: '/bin/zsh' }

  it('forces assume-yes / no-tty flags over the inherited env', () => {
    const env = nonInteractiveInstallEnv({ CI: '', TERM: 'xterm-256color' }, overrides)
    assert.equal(env.CI, '1')
    assert.equal(env.TERM, 'dumb')
    assert.equal(env.npm_config_yes, 'true')
    assert.equal(env.GIT_TERMINAL_PROMPT, '0')
    assert.equal(env.DEBIAN_FRONTEND, 'noninteractive')
  })

  it('applies the resolved login PATH and drops electron-only vars', () => {
    const env = nonInteractiveInstallEnv(
      { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require x', PATH: '/tiny' },
      overrides
    )
    assert.equal(env.PATH, '/opt/bin:/usr/bin')
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
    assert.equal(env.NODE_OPTIONS, undefined)
  })

  it('passes through proxy settings the installer needs', () => {
    const env = nonInteractiveInstallEnv({ HTTPS_PROXY: 'http://127.0.0.1:7890' }, overrides)
    assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7890')
  })
})
