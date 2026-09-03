import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { TOOL_OUTPUT_CAP } from '../../shared/types.ts'
import {
  cap,
  looksLikeServerCommand,
  summarizeToolInput,
  truncateToolSummary
} from './toolSummarize.ts'

describe('cap', () => {
  it('returns short text unchanged', () => {
    assert.equal(cap('hello'), 'hello')
  })

  it('keeps head and tail when over the cap', () => {
    const text = 'a'.repeat(TOOL_OUTPUT_CAP + 10)
    const out = cap(text)
    assert.match(out, /10 characters omitted/)
    assert.equal(out.startsWith('a'.repeat(Math.floor(TOOL_OUTPUT_CAP / 2))), true)
    assert.equal(out.endsWith('a'.repeat(Math.floor(TOOL_OUTPUT_CAP / 2))), true)
  })
})

describe('looksLikeServerCommand', () => {
  it('matches common never-exit servers', () => {
    assert.equal(looksLikeServerCommand('npm run dev'), true)
    assert.equal(looksLikeServerCommand('npx vite'), true)
    assert.equal(looksLikeServerCommand('python -m http.server'), true)
    assert.equal(looksLikeServerCommand('ls -la'), false)
  })
})

describe('truncateToolSummary / summarizeToolInput', () => {
  it('flattens whitespace and ellipsizes', () => {
    assert.equal(truncateToolSummary('  a   b  ', 10), 'a b')
    assert.equal(truncateToolSummary('abcdefghijk', 5), 'abcde…')
  })

  it('labels terminal, files, and ask/plan cards', () => {
    assert.equal(summarizeToolInput('terminal', { command: 'ls' }), 'ls')
    assert.equal(
      summarizeToolInput('terminal', { command: 'npm run dev', background: true }),
      'npm run dev (background)'
    )
    assert.equal(summarizeToolInput('fs_list', {}), '.')
    assert.equal(
      summarizeToolInput('read_bash_session', { tailLines: 50 }, 'sess'),
      'tailLines: 50, sessionId: sess'
    )
    assert.equal(summarizeToolInput('switch_mode', {}), 'Switch to Edit')
    assert.match(
      summarizeToolInput('plan', {
        title: 'Ship',
        steps: [{ title: 'a', status: 'done' }, { title: 'b' }]
      }),
      /Plan · Ship \(1\/2\)/
    )
    assert.equal(
      summarizeToolInput('ask_user_question', { question: 'Which one?' }),
      'Which one?'
    )
  })
})
