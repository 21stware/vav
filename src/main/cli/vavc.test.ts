import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { completionScript, positional, vavcHelp } from './vavc.ts'
import { vavcliHelp } from './vavcli.ts'

describe('vavc / vavcli help', () => {
  it('covers the herdr-style control surface', () => {
    const help = vavcHelp()
    assert.match(help, /vavc status/)
    assert.match(help, /vavc server/)
    assert.match(help, /vavc session list/)
    assert.match(help, /vavc workspace create/)
    assert.match(help, /vavc agent prompt/)
    assert.match(help, /vavc completion/)
    assert.match(help, /--uri/)
    assert.match(help, /--state/)
  })

  it('covers the pi-style agent surface', () => {
    const help = vavcliHelp()
    assert.match(help, /-p, --print/)
    assert.match(help, /--mode text\|json\|rpc/)
    assert.match(help, /-c, --continue/)
    assert.match(help, /--session/)
    assert.match(help, /--cwd/)
  })

  it('parses nested herdr verbs', () => {
    assert.deepEqual(positional(['node', 'vavc', 'session', 'list', '--json']), ['session', 'list'])
    assert.deepEqual(positional(['node', 'vavc', 'agent', 'prompt', 'abc', 'hello', '--wait']), [
      'agent',
      'prompt',
      'abc',
      'hello'
    ])
  })

  it('emits shell completion scripts', () => {
    assert.match(completionScript('zsh'), /#compdef vavc/)
    assert.match(completionScript('bash'), /complete -W/)
    assert.match(completionScript('fish'), /complete -c vavc/)
  })
})
