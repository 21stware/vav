import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseTimerPatch } from './vavDaemonCli.ts'
import { completionScript, positional, vavcHelp } from '../../../packages/vavc/src/vavc.ts'
import { vavcliArgvIntent, vavcliHelp } from '../../../packages/vav-cli/src/vavcli.ts'

describe('vavc / vavcli help', () => {
  it('covers the herdr-style control surface', () => {
    const help = vavcHelp()
    assert.match(help, /vavc status/)
    assert.match(help, /vavc server/)
    assert.match(help, /vavc session list/)
    assert.match(help, /vavc session pin/)
    assert.match(help, /vavc session compact/)
    assert.match(help, /vavc session duplicate/)
    assert.match(help, /vavc session regenerate/)
    assert.match(help, /vavc session goal/)
    assert.match(help, /vavc session locate/)
    assert.match(help, /vavc session delete-message/)
    assert.match(help, /vavc session leaf/)
    assert.match(help, /vavc session continue/)
    assert.match(help, /vavc session usage/)
    assert.match(help, /vavc workspace create/)
    assert.match(help, /vavc workspace browse/)
    assert.match(help, /--files/)
    assert.match(help, /vavc agent prompt/)
    assert.match(help, /vavc file list/)
    assert.match(help, /vavc file reveal/)
    assert.match(help, /file mkdir/)
    assert.match(help, /file rename/)
    assert.match(help, /vavc file-session open/)
    assert.match(help, /vavc pane run/)
    assert.match(help, /vavc host/)
    assert.match(help, /host \[info\|pairing\|rotate\|incoming\]/)
    assert.match(help, /host disconnect/)
    assert.match(help, /host unpair/)
    assert.match(help, /vavc account list/)
    assert.match(help, /account draft/)
    assert.match(help, /account update/)
    assert.match(help, /account current/)
    assert.match(help, /account verify/)
    assert.match(help, /account reveal/)
    assert.match(help, /account oauth/)
    assert.match(help, /logs record/)
    assert.match(help, /logs tail/)
    assert.match(help, /account cancel/)
    assert.match(help, /account signout/)
    assert.match(help, /vavc settings/)
    assert.match(help, /settings secret/)
    assert.match(help, /settings hint/)
    assert.match(help, /settings reveal-secret/)
    assert.match(help, /vavc logs/)
    assert.match(help, /vavc git status/)
    assert.match(help, /git init/)
    assert.match(help, /git branch/)
    assert.match(help, /git checkout/)
    assert.match(help, /git worktree/)
    assert.match(help, /vavc github pulls/)
    assert.match(help, /github actions/)
    assert.match(help, /github releases/)
    assert.match(help, /github pages/)
    assert.match(help, /vavc plugins list/)
    assert.match(help, /create <skill/)
    assert.match(help, /plugins enable/)
    assert.match(help, /vavc timers list/)
    assert.match(help, /create \| add/)
    assert.match(help, /vavc timers update/)
    assert.match(help, /vavc connectors/)
    assert.match(help, /login/)
    assert.match(help, /connectors \[login/)
    assert.match(help, /status <cloudflare/)
    assert.match(help, /act <id>/)
    assert.match(help, /vavc review seed/)
    assert.match(help, /accept-all/)
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
    assert.match(help, /\/help/)
    assert.match(help, /\/files/)
    assert.match(help, /\/file/)
    assert.match(help, /\/git/)
    assert.match(help, /\/star/)
    assert.match(help, /\/archive/)
    assert.match(help, /\/stop/)
    assert.match(help, /\/plugins/)
    assert.match(help, /\/plugins \[list\|create/)
    assert.match(help, /\/connectors/)
    assert.match(help, /\/logs/)
    assert.match(help, /\/file-session/)
    assert.match(help, /\/diff/)
    assert.match(help, /\/github/)
    assert.match(help, /\/timers/)
    assert.match(help, /\/status/)
    assert.match(help, /\/export/)
    assert.match(help, /\/permissions/)
    assert.match(help, /\/cost/)
    assert.match(help, /\/init/)
    assert.match(help, /\/compact/)
    assert.match(help, /\/duplicate/)
    assert.match(help, /\/regenerate/)
    assert.match(help, /\/fork/)
    assert.match(help, /\/goal/)
    assert.match(help, /\/locate/)
    assert.match(help, /\/leaf/)
    assert.match(help, /\/delete/)
    assert.match(help, /\/reply/)
    assert.match(help, /\/edit/)
    assert.match(help, /\/continue/)
    assert.match(help, /\/review/)
    assert.match(help, /\/account/)
    assert.match(help, /\/account oauth/)
    assert.match(help, /\/connectors/)
    assert.match(help, /\/settings/)
    assert.match(help, /vavcli \/files/)
  })

  it('treats bare slash argv as commands, not a printed turn', () => {
    assert.deepEqual(vavcliArgvIntent(['node', 'vavcli', '/files', '--session', 's1']), {
      slashes: ['/files'],
      prompt: ''
    })
    assert.deepEqual(vavcliArgvIntent(['node', 'vavcli', '/files', '/tmp/ws', '--session', 's1']), {
      slashes: ['/files /tmp/ws'],
      prompt: ''
    })
    assert.deepEqual(vavcliArgvIntent(['node', 'vavcli', '/files', '/settings', '--uri', 'vavrtp://x']), {
      slashes: ['/files', '/settings'],
      prompt: ''
    })
    assert.deepEqual(vavcliArgvIntent(['node', 'vavcli', '-p', '/files please']), {
      slashes: [],
      prompt: '/files please'
    })
    assert.deepEqual(vavcliArgvIntent(['node', 'vavcli', 'hello world']), {
      slashes: [],
      prompt: 'hello world'
    })
  })

  it('parses timer update flags', () => {
    assert.deepEqual(
      parseTimerPatch(['update', 'job-1', '--title', 'CLI timer', '--enabled', 'off', '--cron', '0 8 * * *']),
      { title: 'CLI timer', enabled: false, schedule: { kind: 'cron', expr: '0 8 * * *' } }
    )
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
    assert.match(completionScript('fish'), /file/)
    assert.match(completionScript('fish'), /pane/)
    assert.match(completionScript('fish'), /review/)
    assert.match(completionScript('fish'), /accept-all/)
  })
})
