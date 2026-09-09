import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseTimerPatch } from './vavDaemonCli.ts'
import { completionScript, positional, vavBoardHelp } from '../../../packages/vav-board/src/vav-board.ts'
import { vavTuiArgvIntent, vavTuiHelp } from '../../../packages/vav-tui/src/vav-tui.ts'

describe('vav-board / vav-tui help', () => {
  it('covers the herdr-style control surface', () => {
    const help = vavBoardHelp()
    assert.match(help, /vav-board status/)
    assert.match(help, /vav-board server/)
    assert.match(help, /vav-board session list/)
    assert.match(help, /vav-board session pin/)
    assert.match(help, /vav-board session compact/)
    assert.match(help, /vav-board session duplicate/)
    assert.match(help, /vav-board session regenerate/)
    assert.match(help, /vav-board session goal/)
    assert.match(help, /vav-board session locate/)
    assert.match(help, /vav-board session delete-message/)
    assert.match(help, /vav-board session leaf/)
    assert.match(help, /vav-board session continue/)
    assert.match(help, /vav-board session usage/)
    assert.match(help, /vav-board workspace create/)
    assert.match(help, /vav-board workspace browse/)
    assert.match(help, /--files/)
    assert.match(help, /vav-board agent prompt/)
    assert.match(help, /vav-board file list/)
    assert.match(help, /vav-board file reveal/)
    assert.match(help, /file mkdir/)
    assert.match(help, /file rename/)
    assert.match(help, /vav-board file-session open/)
    assert.match(help, /vav-board pane run/)
    assert.match(help, /vav-board host/)
    assert.match(help, /host \[info\|pairing\|rotate\|incoming\]/)
    assert.match(help, /host disconnect/)
    assert.match(help, /host unpair/)
    assert.match(help, /vav-board account list/)
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
    assert.match(help, /vav-board settings/)
    assert.match(help, /settings secret/)
    assert.match(help, /settings hint/)
    assert.match(help, /settings reveal-secret/)
    assert.match(help, /vav-board logs/)
    assert.match(help, /vav-board git status/)
    assert.match(help, /git init/)
    assert.match(help, /git branch/)
    assert.match(help, /git checkout/)
    assert.match(help, /git worktree/)
    assert.match(help, /vav-board github pulls/)
    assert.match(help, /github actions/)
    assert.match(help, /github releases/)
    assert.match(help, /github pages/)
    assert.match(help, /vav-board plugins list/)
    assert.match(help, /create <skill/)
    assert.match(help, /plugins enable/)
    assert.match(help, /vav-board timers list/)
    assert.match(help, /create \| add/)
    assert.match(help, /vav-board timers update/)
    assert.match(help, /vav-board connectors/)
    assert.match(help, /login/)
    assert.match(help, /connectors \[login/)
    assert.match(help, /status <cloudflare/)
    assert.match(help, /act <id>/)
    assert.match(help, /vav-board review seed/)
    assert.match(help, /accept-all/)
    assert.match(help, /vav-board completion/)
    assert.match(help, /--uri/)
    assert.match(help, /--state/)
  })

  it('covers the pi-style agent surface', () => {
    const help = vavTuiHelp()
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
    assert.match(help, /vav-tui \/files/)
  })

  it('treats bare slash argv as commands, not a printed turn', () => {
    assert.deepEqual(vavTuiArgvIntent(['node', 'vav-tui', '/files', '--session', 's1']), {
      slashes: ['/files'],
      prompt: ''
    })
    assert.deepEqual(vavTuiArgvIntent(['node', 'vav-tui', '/files', '/tmp/ws', '--session', 's1']), {
      slashes: ['/files /tmp/ws'],
      prompt: ''
    })
    assert.deepEqual(vavTuiArgvIntent(['node', 'vav-tui', '/files', '/settings', '--uri', 'vavrtp://x']), {
      slashes: ['/files', '/settings'],
      prompt: ''
    })
    assert.deepEqual(vavTuiArgvIntent(['node', 'vav-tui', '-p', '/files please']), {
      slashes: [],
      prompt: '/files please'
    })
    assert.deepEqual(vavTuiArgvIntent(['node', 'vav-tui', 'hello world']), {
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
    assert.deepEqual(positional(['node', 'vav-board', 'session', 'list', '--json']), ['session', 'list'])
    assert.deepEqual(positional(['node', 'vav-board', 'agent', 'prompt', 'abc', 'hello', '--wait']), [
      'agent',
      'prompt',
      'abc',
      'hello'
    ])
  })

  it('emits shell completion scripts', () => {
    assert.match(completionScript('zsh'), /#compdef vav-board/)
    assert.match(completionScript('bash'), /complete -W/)
    assert.match(completionScript('fish'), /complete -c vav-board/)
    assert.match(completionScript('fish'), /file/)
    assert.match(completionScript('fish'), /pane/)
    assert.match(completionScript('fish'), /review/)
    assert.match(completionScript('fish'), /accept-all/)
  })
})
