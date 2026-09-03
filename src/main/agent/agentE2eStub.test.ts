import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnEvent } from '../../shared/types.ts'
import {
  E2E_STUB_APPROVE_ID,
  E2E_STUB_ASK_ID,
  completeE2eStubTurn,
  e2eApproveIsApproved,
  e2eStubApproveBlock,
  e2eStubAskBlock,
  e2eStubReplyMessage,
  startE2eStubAsk,
  startE2eStubApprove
} from './agentE2eStub.ts'

describe('e2e stub cards', () => {
  it('builds the ask and approve cards Playwright asserts on', () => {
    const ask = e2eStubAskBlock()
    assert.equal(ask.id, E2E_STUB_ASK_ID)
    assert.equal(ask.tool, 'ask_user_question')
    assert.equal(ask.status, 'pending')
    const approve = e2eStubApproveBlock()
    assert.equal(approve.id, E2E_STUB_APPROVE_ID)
    assert.equal(approve.tool, 'fs_write')
    assert.equal(e2eApproveIsApproved('Approve'), true)
    assert.equal(e2eApproveIsApproved('Deny'), false)
    const reply = e2eStubReplyMessage(null, 'e2e stub reply', 'm1', 1)
    assert.equal(reply.content, 'e2e stub reply')
    assert.equal(reply.parentId, null)
  })

  it('emits start then end for a stub turn', () => {
    const events: TurnEvent['type'][] = []
    completeE2eStubTurn(
      {
        emit: (event) => events.push(event.type),
        append: () => undefined
      },
      'c1',
      null
    )
    assert.deepEqual(events, ['start', 'end'])
  })

  it('parks ask/approve until the waiter fires', () => {
    const waiters = new Map<string, (text: string) => void>()
    const events: TurnEvent['type'][] = []
    startE2eStubAsk(
      {
        emit: (event) => events.push(event.type),
        append: () => undefined
      },
      waiters,
      'c1',
      'parent'
    )
    assert.deepEqual(events, ['start', 'phase', 'awaiting'])
    assert.equal(waiters.has(E2E_STUB_ASK_ID), true)
    waiters.get(E2E_STUB_ASK_ID)!('Keep writing')
    assert.equal(events.at(-1), 'end')

    const approveEvents: TurnEvent['type'][] = []
    const approveWaiters = new Map<string, (text: string) => void>()
    startE2eStubApprove(
      {
        emit: (event) => approveEvents.push(event.type),
        append: () => undefined
      },
      approveWaiters,
      'c1',
      null
    )
    approveWaiters.get(E2E_STUB_APPROVE_ID)!('Deny')
    assert.equal(approveEvents.at(-1), 'end')
  })
})
