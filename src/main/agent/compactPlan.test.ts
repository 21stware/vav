import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatMessage } from '../../shared/types.ts'
import { compactClearGate, planConversationCompact } from './compactPlan.ts'

const errors = {
  busy: 'busy',
  missing: 'missing',
  cliHost: 'cli',
  empty: 'empty',
  notEnough: 'short'
}

function msg(id: string, parentId: string | null = null): ChatMessage {
  return {
    id,
    parentId,
    role: 'user',
    content: id,
    blocks: [],
    createdAt: 0
  }
}

describe('compactClearGate', () => {
  it('blocks running, missing, and CLI-hosted conversations', () => {
    assert.deepEqual(
      compactClearGate({ isRunning: true, conversation: { cliHost: null }, errors }),
      { ok: false, error: 'busy' }
    )
    assert.deepEqual(
      compactClearGate({ isRunning: false, conversation: null, errors }),
      { ok: false, error: 'missing' }
    )
    assert.deepEqual(
      compactClearGate({
        isRunning: false,
        conversation: { cliHost: 'claude' },
        errors
      }),
      { ok: false, error: 'cli' }
    )
    assert.deepEqual(
      compactClearGate({ isRunning: false, conversation: { cliHost: null }, errors }),
      { ok: true }
    )
  })
})

describe('planConversationCompact', () => {
  it('folds the prefix when the thread is long enough', () => {
    const messages = [
      msg('a'),
      msg('b', 'a'),
      msg('c', 'b'),
      msg('d', 'c'),
      msg('e', 'd'),
      msg('f', 'e'),
      msg('g', 'f'),
      msg('h', 'g')
    ]
    const plan = planConversationCompact({
      isRunning: false,
      conversation: { messages, activeLeafId: 'h' },
      errors
    })
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.leafId, 'h')
    assert.ok(plan.toFold.length >= 2)
    assert.equal(plan.kept[0]?.id, plan.keepAfterMessageId)
  })

  it('rejects a keep-after that would fold too little', () => {
    const messages = [msg('a'), msg('b', 'a'), msg('c', 'b')]
    const plan = planConversationCompact({
      isRunning: false,
      conversation: { messages, activeLeafId: 'c' },
      keepAfterMessageId: 'b',
      errors
    })
    assert.deepEqual(plan, { ok: false, error: 'short' })
  })

  it('rejects an empty thread', () => {
    const plan = planConversationCompact({
      isRunning: false,
      conversation: { messages: [], activeLeafId: null },
      errors
    })
    assert.deepEqual(plan, { ok: false, error: 'empty' })
  })
})
