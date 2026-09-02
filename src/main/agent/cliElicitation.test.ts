import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { elicitationCardFields, findPendingElicitationIndex } from './cliElicitation.ts'

const labels = { ask: 'Ask', open: 'Open', cancel: 'Cancel' }

describe('elicitationCardFields', () => {
  it('maps ask / url / plan-doc kinds onto tool cards', () => {
    const ask = elicitationCardFields(
      { kind: 'ask', title: 'Choose', input: { question: 'Next?', choices: ['A'] } },
      labels
    )
    assert.equal(ask.tool, 'ask_user_question')
    assert.equal(ask.summary, 'Choose')
    assert.equal(ask.questions?.[0]?.question, 'Next?')

    const url = elicitationCardFields(
      { kind: 'url', input: { url: 'https://example.com' } },
      labels
    )
    assert.equal(url.tool, 'request')
    assert.equal(url.summary, 'https://example.com')
    assert.deepEqual(url.choices, ['Open', 'Cancel'])

    const plan = elicitationCardFields(
      { kind: 'plan_doc', input: { name: 'Ship', overview: 'Do the thing' } },
      labels
    )
    assert.equal(plan.tool, 'plan_doc')
    assert.equal(plan.summary, 'Do the thing')
  })

  it('falls back to the ask label when title and body are missing', () => {
    const ask = elicitationCardFields({ kind: 'ask', input: {} }, labels)
    assert.equal(ask.summary, 'Ask')
  })

  it('reuses a parked elicitation card when the host remaps the id', () => {
    const pending = new Map([
      ['old', { kind: 'ask' }],
      ['other', { kind: 'form' }]
    ])
    const toolIndex = new Map([
      ['old', 3],
      ['other', 4]
    ])
    assert.deepEqual(findPendingElicitationIndex(pending, toolIndex, 'ask'), {
      index: 3,
      previousId: 'old'
    })
    assert.equal(findPendingElicitationIndex(pending, toolIndex, 'url'), null)
    assert.equal(findPendingElicitationIndex(pending, new Map(), 'ask'), null)
  })
})
