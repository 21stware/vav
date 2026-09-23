import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { composeCliPrompt } from './cliPrompt.ts'

describe('composeCliPrompt', () => {
  it('joins open file, selection, attachments, and text', () => {
    const prompt = composeCliPrompt(
      'do it',
      [{ id: 'r', filePath: '/a.ts', label: 'a.ts', startLine: 1, endLine: 2, text: 'x' }],
      ['/img.png'],
      '/notes.md',
      true,
      false
    )
    assert.match(prompt, /\[Open file — read only\]\n\/notes\.md/)
    assert.match(prompt, /\[Selection \/a\.ts:1-2\]\nx/)
    assert.match(prompt, /\[Attachments\]\n- \/img\.png/)
    assert.match(prompt, /\ndo it$/)
  })

  it('omits attachment paths when asked and skips empty context', () => {
    assert.equal(composeCliPrompt('hi', null, ['/a'], null, false, true), 'hi')
    assert.equal(composeCliPrompt('hi', [], [], null), 'hi')
  })

  it('carries the selected VAV note on the outbound prompt', () => {
    const prompt = composeCliPrompt(
      '调研金价，写到 Note 里',
      null,
      [],
      null,
      false,
      false,
      {
        kind: 'knowledge',
        level: 'item',
        title: 'Meeting notes',
        path: '/tmp/notes/kh1.md',
        objectId: 'n1',
        url: 'vav://app/knowledge?id=kh1'
      }
    )
    assert.match(prompt, /## VAV app context/)
    assert.match(prompt, /Meeting notes/)
    assert.match(prompt, /调研金价，写到 Note 里$/)
  })
})
