import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shortenModelLabel } from './shortenModelLabel.ts'

describe('shortenModelLabel', () => {
  it('strips a Cursor prefix and trims', () => {
    assert.equal(shortenModelLabel('Cursor Grok 3.4', 'Cursor'), 'Grok 3.4')
  })

  it('strips the first word of a multi-word provider', () => {
    assert.equal(shortenModelLabel('Claude Sonnet 4', 'Claude Code'), 'Sonnet 4')
  })

  it('keeps a label that only is the provider plus a version', () => {
    assert.equal(shortenModelLabel('Grok 3.4', 'Grok build'), 'Grok 3.4')
  })

  it('leaves unrelated labels alone', () => {
    assert.equal(shortenModelLabel('GPT-5.2', 'Codex'), 'GPT-5.2')
  })

  it('is a no-op without a provider name', () => {
    assert.equal(shortenModelLabel('Cursor Grok 3.4', null), 'Cursor Grok 3.4')
  })
})
