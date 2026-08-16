import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { markdownToPlainText } from './markdownPlain.ts'

describe('markdownToPlainText', () => {
  it('strips marks, links, and headings', () => {
    assert.equal(
      markdownToPlainText('# Title\n\nHello **world** and [docs](https://x.test).'),
      'Title\n\nHello world and docs.'
    )
  })

  it('keeps fenced code bodies', () => {
    assert.equal(markdownToPlainText('```ts\nconst n = 1\n```'), 'const n = 1')
  })
})
