import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applySwarmSessionArgs,
  bindingSessionIds,
  canApplyResumeArgs,
  canMintSwarmSessionId,
  clipProjectedTitle,
  mintSwarmCursor,
  nativeSessionId,
  newestBinding,
  stripSessionArgs,
  type CliPaneBinding
} from './cliPaneBinding.ts'

describe('stripSessionArgs', () => {
  it('removes resume / session / continue flags and keeps host defaults', () => {
    assert.deepEqual(
      stripSessionArgs([
        '--always-approve',
        '--resume',
        'abc',
        '--permission-mode',
        'bypassPermissions',
        '--continue'
      ]),
      ['--always-approve', '--permission-mode', 'bypassPermissions']
    )
  })

  it('drops a leading Codex resume subcommand', () => {
    assert.deepEqual(stripSessionArgs(['resume', 'thread-1', '--dangerously-bypass-approvals-and-sandbox']), [
      '--dangerously-bypass-approvals-and-sandbox'
    ])
  })
})

describe('applySwarmSessionArgs', () => {
  it('mints Claude / Grok with --session-id', () => {
    assert.deepEqual(
      applySwarmSessionArgs('grok', ['--always-approve'], null, 'new-id'),
      ['--always-approve', '--session-id', 'new-id']
    )
    assert.deepEqual(
      applySwarmSessionArgs('claude', ['--dangerously-skip-permissions'], null, 'new-id'),
      ['--dangerously-skip-permissions', '--session-id', 'new-id']
    )
  })

  it('uses --session-id when a cursor was just minted, not --resume', () => {
    const cursor = mintSwarmCursor('grok', 'new-id')
    assert.deepEqual(
      applySwarmSessionArgs('grok', ['--always-approve'], cursor, 'new-id'),
      ['--always-approve', '--session-id', 'new-id']
    )
  })

  it('resumes Claude / Grok with --resume and never --continue', () => {
    const cursor = mintSwarmCursor('grok', 'sess-1')
    assert.deepEqual(applySwarmSessionArgs('grok', ['--always-approve', '--continue'], cursor, null), [
      '--always-approve',
      '--resume',
      'sess-1'
    ])
  })

  it('resumes Codex via `resume <id>` before default flags', () => {
    const cursor = mintSwarmCursor('codex', 'thread-9')
    assert.deepEqual(
      applySwarmSessionArgs('codex', ['--dangerously-bypass-approvals-and-sandbox'], cursor, null),
      ['resume', 'thread-9', '--dangerously-bypass-approvals-and-sandbox']
    )
  })

  it('resumes OpenCode with --session', () => {
    const cursor = mintSwarmCursor('opencode', 'ses_abc')
    assert.deepEqual(applySwarmSessionArgs('opencode', ['--auto'], cursor, null), [
      '--auto',
      '--session',
      'ses_abc'
    ])
  })

  it('resumes Cursor with --resume only when a chat id already exists', () => {
    const cursor = mintSwarmCursor('cursor', 'cur-1')
    assert.deepEqual(applySwarmSessionArgs('cursor', ['--force', '--trust'], cursor, null), [
      '--force',
      '--trust',
      '--resume',
      'cur-1'
    ])
    assert.deepEqual(applySwarmSessionArgs('cursor', ['--force', '--trust'], null, null), [
      '--force',
      '--trust'
    ])
  })

  it('starts a new Grok session with --session-id and never --continue', () => {
    assert.deepEqual(
      applySwarmSessionArgs('grok', ['--always-approve', '--continue'], null, 'new-uuid'),
      ['--always-approve', '--session-id', 'new-uuid']
    )
  })

  it('does not invent resume flags for unknown TUI hosts', () => {
    const cursor = mintSwarmCursor('kiro', 'k-1')
    assert.deepEqual(applySwarmSessionArgs('kiro', ['--trust-all-tools'], cursor, null), [
      '--trust-all-tools'
    ])
  })

  it('only mints on Claude and Grok', () => {
    assert.equal(canMintSwarmSessionId('grok'), true)
    assert.equal(canMintSwarmSessionId('claude'), true)
    assert.equal(canMintSwarmSessionId('codex'), false)
    assert.equal(canMintSwarmSessionId('cursor'), false)
  })

  it('resumes only hosts whose CLI flags we know', () => {
    assert.equal(canApplyResumeArgs('grok'), true)
    assert.equal(canApplyResumeArgs('claude'), true)
    assert.equal(canApplyResumeArgs('codex'), true)
    assert.equal(canApplyResumeArgs('opencode'), true)
    assert.equal(canApplyResumeArgs('cursor'), true)
  })
})

describe('cursor helpers', () => {
  it('reads the native id from each provider shape', () => {
    assert.equal(nativeSessionId(mintSwarmCursor('codex', 't1')), 't1')
    assert.equal(nativeSessionId(mintSwarmCursor('antigravity', 'c1')), 'c1')
    assert.equal(nativeSessionId(mintSwarmCursor('grok', 'g1')), 'g1')
  })

  it('picks the newest binding and excludes a pane from the id set', () => {
    const bindings: Record<string, CliPaneBinding> = {
      a: {
        tabId: 'a',
        agentId: 'grok',
        cursor: mintSwarmCursor('grok', 'one')!,
        updatedAt: 1
      },
      b: {
        tabId: 'b',
        agentId: 'grok',
        cursor: mintSwarmCursor('grok', 'two')!,
        updatedAt: 9
      }
    }
    assert.equal(newestBinding(bindings)?.tabId, 'b')
    assert.deepEqual([...bindingSessionIds(bindings, 'b')].sort(), ['one'])
  })

  it('clips projected titles', () => {
    assert.equal(clipProjectedTitle('  Read Swarm  '), 'Read Swarm')
    assert.ok(clipProjectedTitle('x'.repeat(90)).endsWith('…'))
  })
})
