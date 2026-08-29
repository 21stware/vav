import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  shouldArmPlanDocFollowUp,
  shouldContinueHeldCliTurn,
  shouldDeferCliTurnFinish
} from './cliTurnHold.ts'

describe('shouldDeferCliTurnFinish', () => {
  it('holds a successful finish while a plan / ask is pending', () => {
    assert.equal(shouldDeferCliTurnFinish(1, false), true)
  })

  it('does not hold an empty turn', () => {
    assert.equal(shouldDeferCliTurnFinish(0, false), false)
  })

  it('does not hold a cancelled turn', () => {
    assert.equal(shouldDeferCliTurnFinish(1, true), false)
  })
})

describe('shouldContinueHeldCliTurn', () => {
  it('continues after Accept when the host already closed the prompt', () => {
    assert.equal(
      shouldContinueHeldCliTurn({
        hostPromptClosed: true,
        remaining: 0,
        allow: true,
        alreadySteered: false
      }),
      true
    )
  })

  it('does not double-prompt when Accept already steered', () => {
    assert.equal(
      shouldContinueHeldCliTurn({
        hostPromptClosed: true,
        remaining: 0,
        allow: true,
        alreadySteered: true
      }),
      false
    )
  })

  it('does not continue after Reject', () => {
    assert.equal(
      shouldContinueHeldCliTurn({
        hostPromptClosed: true,
        remaining: 0,
        allow: false,
        alreadySteered: false
      }),
      false
    )
  })

  it('waits when another card is still pending', () => {
    assert.equal(
      shouldContinueHeldCliTurn({
        hostPromptClosed: true,
        remaining: 1,
        allow: true,
        alreadySteered: false
      }),
      false
    )
  })
})

describe('shouldArmPlanDocFollowUp', () => {
  it('arms when a plan is accepted while the host prompt is still open (Cursor)', () => {
    assert.equal(
      shouldArmPlanDocFollowUp({
        kind: 'plan_doc',
        allow: true,
        hostPromptClosed: false,
        remaining: 0,
        alreadySteered: false
      }),
      true
    )
  })

  it('does not arm when the held path already steered', () => {
    assert.equal(
      shouldArmPlanDocFollowUp({
        kind: 'plan_doc',
        allow: true,
        hostPromptClosed: true,
        remaining: 0,
        alreadySteered: false
      }),
      false
    )
  })

  it('does not arm on reject', () => {
    assert.equal(
      shouldArmPlanDocFollowUp({
        kind: 'plan_doc',
        allow: false,
        hostPromptClosed: false,
        remaining: 0,
        alreadySteered: false
      }),
      false
    )
  })

  it('does not arm for non-plan cards', () => {
    assert.equal(
      shouldArmPlanDocFollowUp({
        kind: 'ask',
        allow: true,
        hostPromptClosed: false,
        remaining: 0,
        alreadySteered: false
      }),
      false
    )
  })

  it('waits while other cards are still pending', () => {
    assert.equal(
      shouldArmPlanDocFollowUp({
        kind: 'plan_doc',
        allow: true,
        hostPromptClosed: false,
        remaining: 1,
        alreadySteered: false
      }),
      false
    )
  })

  it('does not arm when the answer was already steered as a prompt', () => {
    assert.equal(
      shouldArmPlanDocFollowUp({
        kind: 'plan_doc',
        allow: true,
        hostPromptClosed: false,
        remaining: 0,
        alreadySteered: true
      }),
      false
    )
  })
})
