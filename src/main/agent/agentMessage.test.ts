import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isAssistant, textOf, userTurnMessage } from './agentMessage.ts'

describe('agentMessage', () => {
  it('detects assistant messages and joins text parts', () => {
    assert.equal(isAssistant({ role: 'assistant' }), true)
    assert.equal(isAssistant({ role: 'user' }), false)
    assert.equal(isAssistant(null), false)
    assert.equal(textOf([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb')
    assert.equal(textOf('nope'), undefined)
  })

  it('builds a user turn with omitted empty optionals', () => {
    const msg = userTurnMessage({
      id: 'u1',
      parentId: null,
      text: 'hi',
      createdAt: 7,
      quote: { messageId: 'm', summary: 'q', role: 'user' },
      attachments: ['/a.png']
    })
    assert.equal(msg.role, 'user')
    assert.equal(msg.content, 'hi')
    assert.equal(msg.createdAt, 7)
    assert.equal(msg.quoteMessageId, 'm')
    assert.deepEqual(msg.attachments, ['/a.png'])
    assert.equal('contextFile' in msg, false)
  })
})
