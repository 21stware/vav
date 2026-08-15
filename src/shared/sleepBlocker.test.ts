import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hasActiveAgentWork, shouldBlockIdleSleep } from './sleepBlocker.ts'

describe('hasActiveAgentWork', () => {
  it('is false with no turns or panes', () => {
    assert.equal(hasActiveAgentWork({}), false)
    assert.equal(hasActiveAgentWork({ turns: [], cliAgentStatuses: [] }), false)
  })

  it('is true when any structured turn is running', () => {
    assert.equal(hasActiveAgentWork({ turns: ['paused', 'running'] }), true)
  })

  it('ignores paused turns (awaiting the user)', () => {
    assert.equal(hasActiveAgentWork({ turns: ['paused'] }), false)
  })

  it('is true when a CLI agent PTY is classified running', () => {
    assert.equal(hasActiveAgentWork({ cliAgentStatuses: ['idle', 'running'] }), true)
  })

  it('ignores idle and exited CLI panes', () => {
    assert.equal(hasActiveAgentWork({ cliAgentStatuses: ['idle', 'exited'] }), false)
  })
})

describe('shouldBlockIdleSleep', () => {
  it('requires the setting and active work', () => {
    assert.equal(shouldBlockIdleSleep(false, true), false)
    assert.equal(shouldBlockIdleSleep(true, false), false)
    assert.equal(shouldBlockIdleSleep(true, true), true)
  })
})
