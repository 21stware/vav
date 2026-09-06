import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatTimerStamp, nextTimerDue, timerJobDraft } from './timer.ts'

describe('formatTimerStamp', () => {
  it('is YYYYMMDD-HHmmss in local time', () => {
    const stamp = formatTimerStamp(new Date(2026, 8, 6, 17, 2, 3).getTime())
    assert.equal(stamp, '20260906-170203')
  })
})

describe('nextTimerDue', () => {
  it('returns the once time until it has run', () => {
    const at = 1_700_000_000_000
    assert.equal(nextTimerDue({ schedule: { kind: 'once', at }, lastRunAt: null }, at - 10), at)
    assert.equal(nextTimerDue({ schedule: { kind: 'once', at }, lastRunAt: at }, at + 10), null)
  })

  it('intervals from last run, or now when never run', () => {
    const now = 1_000
    assert.equal(
      nextTimerDue({ schedule: { kind: 'interval', everyMs: 5_000 }, lastRunAt: null }, now),
      now
    )
    assert.equal(
      nextTimerDue({ schedule: { kind: 'interval', everyMs: 5_000 }, lastRunAt: 2_000 }, now),
      7_000
    )
  })
})

describe('timerJobDraft', () => {
  it('builds an enabled interval job', () => {
    const job = timerJobDraft({ title: ' Daily ', prompt: 'deploy', everyMinutes: 30, now: 10 })
    assert.equal(job.title, 'Daily')
    assert.deepEqual(job.schedule, { kind: 'interval', everyMs: 30 * 60_000 })
    assert.equal(job.nextRunAt, 10)
    assert.equal(job.enabled, true)
  })
})
