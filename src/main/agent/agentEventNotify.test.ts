import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { activeTurnStatusFromPhase, awaitingNotifyKind, awaitingNotifyTitle, turnCompleteNotifyAction } from './agentEventNotify.ts'

describe('activeTurnStatusFromPhase', () => {
  it('maps parked vs running phases', () => {
    assert.equal(activeTurnStatusFromPhase('awaiting-user'), 'paused')
    assert.equal(activeTurnStatusFromPhase('working'), 'running')
    assert.equal(activeTurnStatusFromPhase('thinking'), 'running')
    assert.equal(activeTurnStatusFromPhase('outputting'), 'running')
    assert.equal(activeTurnStatusFromPhase('retrying'), 'running')
    assert.equal(activeTurnStatusFromPhase('reconnecting'), 'running')
    assert.equal(activeTurnStatusFromPhase('healing'), 'running')
    assert.equal(activeTurnStatusFromPhase('idle'), null)
  })
})

describe('awaitingNotifyKind', () => {
  it('picks OS alert kinds from the parked tool card', () => {
    assert.equal(awaitingNotifyKind('ask_user_question', false), 'ask')
    assert.equal(awaitingNotifyKind('plan_doc', false), 'approval')
    assert.equal(awaitingNotifyKind('request', false), 'request')
    assert.equal(awaitingNotifyKind('fs_write', true), 'approval')
    assert.equal(awaitingNotifyKind('fs_read', false), null)
  })
})

describe('awaitingNotifyTitle / turnCompleteNotifyAction', () => {
  it('picks the injected title and completes only a clean turn', () => {
    const titles = { ask: 'Ask?', request: 'Request?', approval: 'Approve?' }
    assert.equal(awaitingNotifyTitle('ask', titles), 'Ask?')
    assert.equal(awaitingNotifyTitle('request', titles), 'Request?')
    assert.equal(awaitingNotifyTitle('approval', titles), 'Approve?')
    assert.equal(turnCompleteNotifyAction(false, undefined), 'complete')
    assert.equal(turnCompleteNotifyAction(true, undefined), 'acknowledge')
    assert.equal(turnCompleteNotifyAction(false, 'boom'), 'acknowledge')
  })
})
