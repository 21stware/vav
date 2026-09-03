import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { composeCliPrompt } from './cliPrompt.ts'

describe('composeCliPrompt', () => {
  it('joins open file, selection, attachments, quote, and text', () => {
    const prompt = composeCliPrompt(
      'do it',
      { messageId: 'm', summary: 'earlier', role: 'user' },
      [{ id: 'r', filePath: '/a.ts', label: 'a.ts', startLine: 1, endLine: 2, text: 'x' }],
      ['/img.png'],
      '/notes.md',
      true,
      false
    )
    assert.match(prompt, /\[Open file — read only\]\n\/notes\.md/)
    assert.match(prompt, /\[Selection \/a\.ts:1-2\]\nx/)
    assert.match(prompt, /\[Attachments\]\n- \/img\.png/)
    assert.match(prompt, /\[Quoted user message\]\nearlier/)
    assert.match(prompt, /\ndo it$/)
  })

  it('omits attachment paths when asked and skips empty context', () => {
    assert.equal(composeCliPrompt('hi', null, null, ['/a'], null, false, true), 'hi')
    assert.equal(composeCliPrompt('hi', null, [], [], null), 'hi')
  })
})
