import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { allowWorkdirSwitch, isSwarmSurfaceActive } from './workdirSwitch.ts'

describe('isSwarmSurfaceActive', () => {
  it('is only the Swarm surface, not Thread with the setting on', () => {
    assert.equal(isSwarmSurfaceActive(true, true), true)
    assert.equal(isSwarmSurfaceActive(true, false), false)
    assert.equal(isSwarmSurfaceActive(false, true), false)
  })
})

describe('allowWorkdirSwitch', () => {
  it('blocks every switch on Swarm, including a missing root', () => {
    assert.equal(
      allowWorkdirSwitch({ swarmSurface: true, enclosedUnrevealed: false, rootMissing: true }),
      false
    )
  })

  it('blocks an unrevealed enclosed dir on Thread', () => {
    assert.equal(
      allowWorkdirSwitch({
        swarmSurface: false,
        enclosedUnrevealed: true,
        rootMissing: false
      }),
      false
    )
  })

  it('allows recover when the enclosed root is gone', () => {
    assert.equal(
      allowWorkdirSwitch({
        swarmSurface: false,
        enclosedUnrevealed: true,
        rootMissing: true
      }),
      true
    )
  })

  it('allows a normal session workspace switch', () => {
    assert.equal(
      allowWorkdirSwitch({
        swarmSurface: false,
        enclosedUnrevealed: false,
        rootMissing: false
      }),
      true
    )
  })
})
