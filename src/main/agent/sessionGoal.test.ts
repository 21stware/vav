import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { GoalCapability } from '../../shared/acpSession.ts'
import { planSessionGoal } from './sessionGoal.ts'

const slashOnly: GoalCapability = {
  version: 1,
  controlMethod: 'slash',
  actions: ['set', 'pause', 'resume', 'clear']
}

const rpcSet: GoalCapability = {
  version: 1,
  controlMethod: 'rpc',
  actions: ['set', 'pause', 'resume', 'clear'],
  methodActions: ['set', 'clear']
}

describe('planSessionGoal', () => {
  it('rejects missing capability or an unsupported action', () => {
    assert.deepEqual(
      planSessionGoal({ capability: null, action: 'pause', connected: true }),
      { ok: false, error: 'Goal control is not available' }
    )
    assert.deepEqual(
      planSessionGoal({
        capability: { version: 1, controlMethod: 'slash', actions: ['pause'] },
        action: 'clear',
        connected: true
      }),
      { ok: false, error: 'Goal control is not available' }
    )
  })

  it('requires an objective when setting a goal', () => {
    assert.deepEqual(
      planSessionGoal({ capability: slashOnly, action: 'set', objective: '  ', connected: true }),
      { ok: false, error: 'Goal objective is required' }
    )
  })

  it('uses RPC when the capability advertises it and a driver is connected', () => {
    assert.deepEqual(
      planSessionGoal({
        capability: rpcSet,
        action: 'set',
        objective: 'Ship it',
        connected: true
      }),
      { ok: true, via: 'rpc' }
    )
  })

  it('fails RPC when the agent is not connected', () => {
    assert.deepEqual(
      planSessionGoal({ capability: rpcSet, action: 'clear', connected: false }),
      { ok: false, error: 'Agent is not connected' }
    )
  })

  it('falls back to a slash command', () => {
    assert.deepEqual(
      planSessionGoal({ capability: slashOnly, action: 'pause', connected: false }),
      { ok: true, via: 'slash', text: '/goal pause' }
    )
    assert.deepEqual(
      planSessionGoal({
        capability: slashOnly,
        action: 'set',
        objective: 'Ship it',
        connected: true
      }),
      { ok: true, via: 'slash', text: '/goal Ship it' }
    )
  })
})
