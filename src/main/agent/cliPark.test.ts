import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { newCliToolCallBlock } from './cliToolBlock.ts'
import { parkInteractivePatch } from './cliPark.ts'

describe('parkInteractivePatch', () => {
  it('parks an ask card with questions and ignores completed events', () => {
    const block = newCliToolCallBlock({
      id: 'a',
      tool: 'ask_user_question',
      summary: 'q',
      input: JSON.stringify({ question: 'Next?', choices: ['A', 'B'] })
    })
    const parked = parkInteractivePatch(block, { status: 'started', name: 'AskUserQuestion', title: 'Next?' }, false)
    assert.equal(parked?.kind, 'ask')
    assert.equal(parked?.next.status, 'pending')
    assert.equal(parked?.next.questions?.[0]?.question, 'Next?')
    assert.equal(
      parkInteractivePatch(block, { status: 'completed', name: 'AskUserQuestion' }, false),
      null
    )
    assert.equal(
      parkInteractivePatch(block, { status: 'started', name: 'AskUserQuestion' }, true),
      null
    )
  })

  it('parks plan-doc when the name or body says so', () => {
    const block = newCliToolCallBlock({
      id: 'p',
      tool: 'plan_doc',
      summary: 'plan',
      input: JSON.stringify({ title: 'Ship', body: 'Do the thing' })
    })
    assert.equal(
      parkInteractivePatch(block, { status: 'updated', name: 'CreatePlan' }, false)?.kind,
      'plan_doc'
    )
  })
})
