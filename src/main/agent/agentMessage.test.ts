import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isAssistant, stripChangeSetIds, textOf, userTurnMessage, systemNoticeMessage, fatalAssistantMessage } from './agentMessage.ts'

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

  it('builds system notices and fatal assistant cards', () => {
    const notice = systemNoticeMessage({
      id: 'n1',
      parentId: 'p',
      body: 'Discarded',
      createdAt: 9
    })
    assert.equal(notice.role, 'system')
    assert.equal(notice.content, 'Discarded')
    assert.deepEqual(notice.blocks, [{ kind: 'text', text: 'Discarded' }])

    const fatal = fatalAssistantMessage({
      id: 'f1',
      parentId: null,
      error: 'No API key',
      createdAt: 11
    })
    assert.equal(fatal.role, 'assistant')
    assert.equal(fatal.content, 'No API key')
    assert.equal(fatal.errorText, 'No API key')
    assert.deepEqual(fatal.blocks, [{ kind: 'text', text: '> No API key' }])
  })

  it('strips prior changeSetIds in place and reports dirty', () => {
    const messages = [
      { id: 'a', changeSetId: 'cs-1' },
      { id: 'b' },
      { id: 'c', changeSetId: 'cs-2' }
    ]
    assert.equal(stripChangeSetIds(messages), true)
    assert.equal('changeSetId' in messages[0]!, false)
    assert.equal('changeSetId' in messages[2]!, false)
    assert.equal(stripChangeSetIds(messages), false)
  })
})
