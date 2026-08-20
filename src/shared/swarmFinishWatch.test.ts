import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createSwarmFinishWatch,
  isSwarmFinishAgent,
  shouldDeliverSwarmFinishChime,
  SWARM_IDLE_QUIET_MS,
  SWARM_MIN_WORK_MS
} from './swarmFinishWatch.ts'

function sample(
  overrides: Partial<Parameters<ReturnType<typeof createSwarmFinishWatch>['noteStatus']>[0]> = {}
) {
  return {
    tabId: 'pane-1',
    conversationId: 'conv-1',
    agentId: 'claude',
    status: 'idle' as const,
    createdAt: 1_000,
    lastDataAt: 1_200,
    ...overrides
  }
}

describe('isSwarmFinishAgent', () => {
  it('accepts CLI hosts and rejects bash / VAV mirror', () => {
    assert.equal(isSwarmFinishAgent('claude'), true)
    assert.equal(isSwarmFinishAgent('codex'), true)
    assert.equal(isSwarmFinishAgent(null), false)
    assert.equal(isSwarmFinishAgent('vav'), false)
    assert.equal(isSwarmFinishAgent(''), false)
  })
})

describe('createSwarmFinishWatch', () => {
  it('ignores the first idle after a short spawn paint', () => {
    const watch = createSwarmFinishWatch({ now: () => 3_000 })
    assert.equal(watch.noteStatus(sample()), null)
    assert.equal(watch.takeNotify('pane-1'), null)
  })

  it('arms after idle → a long run → idle', () => {
    let now = 10_000
    const watch = createSwarmFinishWatch({ now: () => now })
    assert.equal(watch.noteStatus(sample({ status: 'idle' })), null)
    now = 11_000
    assert.equal(watch.noteStatus(sample({ status: 'running', lastDataAt: 11_000 })), null)
    now = 11_000 + SWARM_MIN_WORK_MS
    const effect = watch.noteStatus(sample({ status: 'idle', lastDataAt: now }))
    assert.deepEqual(effect, {
      type: 'arm',
      tabId: 'pane-1',
      conversationId: 'conv-1',
      delayMs: SWARM_IDLE_QUIET_MS
    })
    assert.deepEqual(watch.takeNotify('pane-1'), { conversationId: 'conv-1' })
    assert.equal(watch.takeNotify('pane-1'), null)
  })

  it('ignores a short running burst after idle (focus-out TUI redraw)', () => {
    let now = 10_000
    const watch = createSwarmFinishWatch({ now: () => now })
    watch.noteStatus(sample({ status: 'idle' }))
    now = 11_000
    watch.noteStatus(sample({ status: 'running', lastDataAt: 11_000 }))
    now = 12_200
    assert.equal(watch.noteStatus(sample({ status: 'idle', lastDataAt: 11_800 })), null)
    assert.equal(watch.takeNotify('pane-1'), null)
  })

  it('cancels a pending chime when the pane goes running again', () => {
    let now = 10_000
    const watch = createSwarmFinishWatch({ now: () => now })
    watch.noteStatus(sample({ status: 'idle' }))
    now = 11_000
    watch.noteStatus(sample({ status: 'running', lastDataAt: 11_000 }))
    now = 11_000 + SWARM_MIN_WORK_MS
    assert.equal(watch.noteStatus(sample({ status: 'idle', lastDataAt: now }))?.type, 'arm')
    now += 1_000
    assert.deepEqual(watch.noteStatus(sample({ status: 'running', lastDataAt: now })), {
      type: 'cancel',
      tabId: 'pane-1'
    })
    assert.equal(watch.takeNotify('pane-1'), null)
  })

  it('treats a long first-turn as finished (launch with a prompt)', () => {
    const createdAt = 1_000
    const lastDataAt = createdAt + SWARM_MIN_WORK_MS
    const watch = createSwarmFinishWatch({ now: () => lastDataAt + 1_200 })
    const effect = watch.noteStatus(
      sample({ status: 'idle', createdAt, lastDataAt })
    )
    assert.equal(effect?.type, 'arm')
  })

  it('does not re-arm while already waiting on the same idle', () => {
    let now = 10_000
    const watch = createSwarmFinishWatch({ now: () => now })
    watch.noteStatus(sample({ status: 'idle' }))
    now = 11_000
    watch.noteStatus(sample({ status: 'running' }))
    now = 11_000 + SWARM_MIN_WORK_MS
    assert.equal(watch.noteStatus(sample({ status: 'idle' }))?.type, 'arm')
    assert.equal(watch.noteStatus(sample({ status: 'idle' })), null)
  })

  it('drops bash and VAV mirror panes', () => {
    const watch = createSwarmFinishWatch({ now: () => 20_000 })
    assert.equal(watch.noteStatus(sample({ agentId: null, status: 'idle' })), null)
    assert.equal(watch.noteStatus(sample({ agentId: 'vav', status: 'idle' })), null)
  })

  it('cancels on exit or teardown', () => {
    let now = 10_000
    const watch = createSwarmFinishWatch({ now: () => now })
    watch.noteStatus(sample({ status: 'idle' }))
    now = 11_000
    watch.noteStatus(sample({ status: 'running' }))
    now = 11_000 + SWARM_MIN_WORK_MS
    watch.noteStatus(sample({ status: 'idle' }))
    assert.deepEqual(watch.noteStatus(sample({ status: 'exited' })), {
      type: 'cancel',
      tabId: 'pane-1'
    })
    assert.equal(watch.takeNotify('pane-1'), null)

    watch.noteStatus(sample({ status: 'idle' }))
    now = 20_000
    watch.noteStatus(sample({ status: 'running' }))
    now = 20_000 + SWARM_MIN_WORK_MS
    watch.noteStatus(sample({ status: 'idle' }))
    assert.deepEqual(watch.noteGone('pane-1'), { type: 'cancel', tabId: 'pane-1' })
  })

  it('keeps sibling panes independent', () => {
    let now = 10_000
    const watch = createSwarmFinishWatch({ now: () => now })
    watch.noteStatus(sample({ tabId: 'a', status: 'idle' }))
    watch.noteStatus(sample({ tabId: 'b', conversationId: 'conv-2', status: 'idle' }))
    now = 11_000
    watch.noteStatus(sample({ tabId: 'a', status: 'running' }))
    watch.noteStatus(sample({ tabId: 'b', conversationId: 'conv-2', status: 'running' }))
    now = 11_000 + SWARM_MIN_WORK_MS
    assert.equal(watch.noteStatus(sample({ tabId: 'a', status: 'idle' }))?.type, 'arm')
    assert.equal(
      watch.noteStatus(sample({ tabId: 'b', conversationId: 'conv-2', status: 'idle' }))?.type,
      'arm'
    )
    assert.deepEqual(watch.takeNotify('a'), { conversationId: 'conv-1' })
    assert.deepEqual(watch.takeNotify('b'), { conversationId: 'conv-2' })
  })
})

describe('shouldDeliverSwarmFinishChime', () => {
  it('fires only when the idle happened in the background and still is', () => {
    assert.equal(
      shouldDeliverSwarmFinishChime({
        completedWhileForeground: false,
        foregroundNow: false
      }),
      true
    )
    assert.equal(
      shouldDeliverSwarmFinishChime({
        completedWhileForeground: true,
        foregroundNow: false
      }),
      false
    )
    assert.equal(
      shouldDeliverSwarmFinishChime({
        completedWhileForeground: false,
        foregroundNow: true
      }),
      false
    )
  })
})
