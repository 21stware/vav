import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEV_PARENT_GONE_MISSES, shouldQuitForMissingParent } from './devParentWatchdog.ts'

describe('shouldQuitForMissingParent', () => {
  it('waits for consecutive misses', () => {
    assert.equal(
      shouldQuitForMissingParent({ consecutiveMisses: 1, now: 100, pausedUntil: 0 }),
      false
    )
    assert.equal(
      shouldQuitForMissingParent({
        consecutiveMisses: DEV_PARENT_GONE_MISSES - 1,
        now: 100,
        pausedUntil: 0
      }),
      false
    )
    assert.equal(
      shouldQuitForMissingParent({
        consecutiveMisses: DEV_PARENT_GONE_MISSES,
        now: 100,
        pausedUntil: 0
      }),
      true
    )
  })

  it('ignores misses during the wake grace window', () => {
    assert.equal(
      shouldQuitForMissingParent({
        consecutiveMisses: DEV_PARENT_GONE_MISSES,
        now: 5000,
        pausedUntil: 10_000
      }),
      false
    )
    assert.equal(
      shouldQuitForMissingParent({
        consecutiveMisses: DEV_PARENT_GONE_MISSES,
        now: 10_000,
        pausedUntil: 10_000
      }),
      true
    )
  })
})
