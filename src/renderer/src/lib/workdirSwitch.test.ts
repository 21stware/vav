import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { allowWorkdirSwitch, isSwarmSurfaceActive, locateWorkspaceDefaultName, swarmBlocksWorkdirSwitch } from './workdirSwitch.ts'

describe('isSwarmSurfaceActive', () => {
  it('is only the Swarm surface, not Thread with the setting on', () => {
    assert.equal(isSwarmSurfaceActive(true, true), true)
    assert.equal(isSwarmSurfaceActive(true, false), false)
    assert.equal(isSwarmSurfaceActive(false, true), false)
  })
})

describe('swarmBlocksWorkdirSwitch', () => {
  it('blocks only a live Swarm surface', () => {
    assert.equal(swarmBlocksWorkdirSwitch(null, true, true), false)
    assert.equal(swarmBlocksWorkdirSwitch('c1', true, true), true)
    assert.equal(swarmBlocksWorkdirSwitch('c1', true, false), false)
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

describe('locateWorkspaceDefaultName', () => {
  it('strips path separators and caps length', () => {
    assert.equal(locateWorkspaceDefaultName(null), 'workspace')
    assert.equal(locateWorkspaceDefaultName('a/b\\c'), 'a-b-c')
    assert.equal(locateWorkspaceDefaultName('x'.repeat(80)).length, 64)
  })
})
