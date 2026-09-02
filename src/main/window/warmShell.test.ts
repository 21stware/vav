import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  replaceLiveWarmPool,
  shouldDestroyParkedWarmShell,
  takeReadyWarmShell,
  waitForReadyWarmShell
} from './warmShell.ts'

function shell(id: string, opts: { destroyed?: boolean } = {}): {
  id: string
  isDestroyed: () => boolean
} {
  return { id, isDestroyed: () => opts.destroyed === true }
}

describe('takeReadyWarmShell', () => {
  it('returns the newest ready window and keeps not-ready shells', () => {
    const a = shell('a')
    const b = shell('b')
    const c = shell('c')
    const pool = [a, b, c]
    const ready = new Set([a, c])
    const taken = takeReadyWarmShell(pool, (win) => ready.has(win))
    assert.equal(taken?.id, 'c')
    assert.deepEqual(
      pool.map((win) => win.id),
      ['a', 'b']
    )
  })

  it('skips destroyed windows at the top of the stack and restores not-ready ones', () => {
    const booting = shell('boot')
    const ready = shell('ready')
    const dead = shell('dead', { destroyed: true })
    const pool = [booting, ready, dead]
    const taken = takeReadyWarmShell(pool, (win) => win.id === 'ready')
    assert.equal(taken?.id, 'ready')
    assert.deepEqual(
      pool.map((win) => win.id),
      ['boot']
    )
  })

  it('returns null when nothing is ready', () => {
    const booting = shell('boot')
    const pool = [booting]
    assert.equal(
      takeReadyWarmShell(pool, () => false),
      null
    )
    assert.deepEqual(
      pool.map((win) => win.id),
      ['boot']
    )
  })
})

describe('replaceLiveWarmPool / shouldDestroyParkedWarmShell', () => {
  it('drops destroyed shells and reports a full pool', () => {
    const live = shell('live')
    const pool = [shell('gone', { destroyed: true }), live]
    replaceLiveWarmPool(pool)
    assert.deepEqual(
      pool.map((win) => win.id),
      ['live']
    )
    assert.equal(shouldDestroyParkedWarmShell(2, 2), true)
    assert.equal(shouldDestroyParkedWarmShell(1, 2), false)
  })
})

describe('waitForReadyWarmShell', () => {
  it('returns a shell as soon as take succeeds, without waiting out the deadline', async () => {
    let now = 0
    let sleeps = 0
    const taken = await waitForReadyWarmShell(
      () => shell('ready'),
      {
        deadline: 100,
        intervalMs: 20,
        now: () => now,
        sleep: async () => {
          sleeps += 1
          now += 20
        }
      }
    )
    assert.equal(taken?.id, 'ready')
    assert.equal(sleeps, 0)
  })

  it('polls until deadline then returns null', async () => {
    let now = 0
    let takes = 0
    const taken = await waitForReadyWarmShell(() => {
      takes += 1
      return null
    }, {
      deadline: 40,
      intervalMs: 20,
      now: () => now,
      sleep: async (ms) => {
        now += ms
      }
    })
    assert.equal(taken, null)
    assert.ok(takes >= 2)
  })
})
