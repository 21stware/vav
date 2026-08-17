import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldAutoAssignSingleCliAgent } from './skipCliPicker.ts'

describe('shouldAutoAssignSingleCliAgent', () => {
  it('skips the picker on a new Swarm or split when the setting is on and one agent is enabled', () => {
    assert.equal(
      shouldAutoAssignSingleCliAgent({
        skipWhenSingle: true,
        enabledCount: 1,
        reason: 'enter'
      }),
      true
    )
    assert.equal(
      shouldAutoAssignSingleCliAgent({
        skipWhenSingle: true,
        enabledCount: 1,
        reason: 'split'
      }),
      true
    )
  })

  it('never auto-launches when reseeding after the last live pane closes', () => {
    assert.equal(
      shouldAutoAssignSingleCliAgent({
        skipWhenSingle: true,
        enabledCount: 1,
        reason: 'reseed'
      }),
      false
    )
  })

  it('keeps the picker when the setting is off or more than one agent is enabled', () => {
    assert.equal(
      shouldAutoAssignSingleCliAgent({
        skipWhenSingle: false,
        enabledCount: 1,
        reason: 'enter'
      }),
      false
    )
    assert.equal(
      shouldAutoAssignSingleCliAgent({
        skipWhenSingle: true,
        enabledCount: 2,
        reason: 'split'
      }),
      false
    )
  })
})
