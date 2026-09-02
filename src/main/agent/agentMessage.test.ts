import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isAssistant, textOf } from './agentMessage.ts'

describe('agentMessage', () => {
  it('detects assistant messages and joins text parts', () => {
    assert.equal(isAssistant({ role: 'assistant' }), true)
    assert.equal(isAssistant({ role: 'user' }), false)
    assert.equal(isAssistant(null), false)
    assert.equal(textOf([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb')
    assert.equal(textOf('nope'), undefined)
  })
})
