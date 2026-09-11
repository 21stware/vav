import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  estimateContextTokens,
  estimateTextTokens,
  historyHasCacheMetrics,
  shouldShowCacheHitUi
} from './tokenUsage.ts'
import type { ChatMessage } from './types.ts'

function message(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm',
    parentId: null,
    role: 'user',
    content: '',
    blocks: [],
    createdAt: 1,
    ...partial
  }
}

describe('estimateTextTokens', () => {
  it('counts latin at ~4 chars/token and CJK at ~1 char/token', () => {
    assert.equal(estimateTextTokens(''), 0)
    assert.equal(estimateTextTokens('abcd'), 1)
    assert.equal(estimateTextTokens('abcde'), 2)
    assert.equal(estimateTextTokens('你好世界'), 4)
    // Mixed: 4 CJK + 8 latin → 4 + 2.
    assert.equal(estimateTextTokens('你好世界abcdefgh'), 6)
  })
})

describe('estimateContextTokens', () => {
  it('sums transcript text, tool payloads, and a system-prompt allowance', () => {
    const base = estimateContextTokens([])
    assert.ok(base >= 1_000, 'includes a fixed overhead allowance')

    const small = estimateContextTokens([message({ content: 'a'.repeat(400) })])
    assert.equal(small - base, 100)

    const withTools = estimateContextTokens([
      message({
        role: 'assistant',
        blocks: [
          { kind: 'reasoning', text: 'b'.repeat(400) },
          {
            kind: 'toolCall',
            id: 't1',
            tool: 'fs_read',
            summary: '',
            input: 'c'.repeat(400),
            output: 'd'.repeat(400),
            status: 'completed',
            children: [{ kind: 'text', text: 'e'.repeat(400) }]
          },
          { kind: 'text', text: 'f'.repeat(400) }
        ]
      })
    ])
    assert.equal(withTools - base, 500)
  })

  it('grows monotonically as the conversation grows', () => {
    const short = estimateContextTokens([message({ content: 'hello' })])
    const long = estimateContextTokens([
      message({ content: 'hello' }),
      message({ id: 'm2', role: 'assistant', content: 'x'.repeat(4_000) })
    ])
    assert.ok(long > short)
  })
})

describe('shouldShowCacheHitUi', () => {
  it('hides the Anthropic cache chart on ACP until a host reports cache tokens', () => {
    assert.equal(historyHasCacheMetrics([]), false)
    assert.equal(historyHasCacheMetrics([{ cacheReadTokens: 0, cacheWriteTokens: 0 }]), false)
    assert.equal(historyHasCacheMetrics([{ cacheReadTokens: 12, cacheWriteTokens: 0 }]), true)
    assert.equal(shouldShowCacheHitUi({ cliHost: 'cursor', history: [] }), false)
    assert.equal(shouldShowCacheHitUi({ cliHost: 'grok', history: [] }), false)
    assert.equal(
      shouldShowCacheHitUi({
        cliHost: 'grok',
        history: [{ cacheReadTokens: 11264, cacheWriteTokens: 0 }]
      }),
      true
    )
    assert.equal(shouldShowCacheHitUi({ cliHost: null, history: [] }), true)
    assert.equal(shouldShowCacheHitUi({ cliHost: 'claude', history: [] }), true)
  })
})
