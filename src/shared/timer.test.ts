import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  coerceTimerSchedule,
  cronMatches,
  formatTimerSchedule,
  formatTimerStamp,
  nextTimerRunAt,
  parseCronExpr
} from './timer.ts'

describe('parseCronExpr', () => {
  it('accepts five fields and rejects junk', () => {
    assert.ok(parseCronExpr('*/15 * * * *'))
    assert.ok(parseCronExpr('0 9 * * 1-5'))
    assert.equal(parseCronExpr('0 9 * *'), null)
    assert.equal(parseCronExpr('every hour'), null)
  })
})

describe('cronMatches', () => {
  it('matches weekday mornings', () => {
    const mondayNine = new Date(2026, 8, 7, 9, 0, 0) // Monday
    assert.equal(cronMatches('0 9 * * 1-5', mondayNine), true)
    assert.equal(cronMatches('0 9 * * 1-5', new Date(2026, 8, 6, 9, 0, 0)), false)
    assert.equal(cronMatches('*/15 * * * *', new Date(2026, 8, 6, 10, 30, 0)), true)
    assert.equal(cronMatches('*/15 * * * *', new Date(2026, 8, 6, 10, 31, 0)), false)
  })
})

describe('nextTimerRunAt', () => {
  it('schedules interval, once, and cron', () => {
    const from = Date.parse('2026-09-06T10:00:00')
    assert.equal(nextTimerRunAt({ kind: 'interval', everyMs: 60_000 }, from), from + 60_000)
    assert.equal(nextTimerRunAt({ kind: 'once', at: from + 5_000 }, from), from + 5_000)
    assert.equal(nextTimerRunAt({ kind: 'once', at: from - 1 }, from), null)
    const nextCron = nextTimerRunAt({ kind: 'cron', expr: '0 11 * * *' }, from)
    assert.ok(nextCron)
    const d = new Date(nextCron!)
    assert.equal(d.getHours(), 11)
    assert.equal(d.getMinutes(), 0)
  })
})

describe('coerceTimerSchedule', () => {
  it('keeps valid shapes only', () => {
    assert.deepEqual(coerceTimerSchedule({ kind: 'cron', expr: '0 * * * *' }), {
      kind: 'cron',
      expr: '0 * * * *'
    })
    assert.equal(coerceTimerSchedule({ kind: 'interval', everyMs: 1000 }), null)
    assert.deepEqual(coerceTimerSchedule({ kind: 'once', at: 1 }), { kind: 'once', at: 1 })
  })
})

describe('formatTimerSchedule', () => {
  it('prints cron, interval, and once', () => {
    assert.equal(formatTimerSchedule({ kind: 'cron', expr: '0 9 * * 1-5' }), '0 9 * * 1-5')
    assert.equal(formatTimerSchedule({ kind: 'interval', everyMs: 60_000 }), 'every 1m')
    assert.equal(formatTimerSchedule({ kind: 'interval', everyMs: 3_600_000 }), 'every 1h')
    assert.match(formatTimerSchedule({ kind: 'once', at: Date.parse('2026-09-06T10:00:00Z') }), /2026/)
  })
})

describe('formatTimerStamp', () => {
  it('is filesystem-safe', () => {
    const stamp = formatTimerStamp(Date.parse('2026-09-06T09:08:07'))
    assert.match(stamp, /^\d{8}-\d{6}$/)
  })
})
