import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultVisualSchedule,
  scheduleFromVisual,
  toggleWeekday,
  visualFromSchedule
} from './cronUi.ts'

describe('scheduleFromVisual / visualFromSchedule', () => {
  it('round-trips daily, weekly, monthly, hourly, and once', () => {
    const daily = { mode: 'daily' as const, hour: 9, minute: 0 }
    assert.deepEqual(scheduleFromVisual(daily), { kind: 'cron', expr: '0 9 * * *' })
    assert.deepEqual(visualFromSchedule({ kind: 'cron', expr: '0 9 * * *' }), daily)

    const weekly = { mode: 'weekly' as const, hour: 9, minute: 30, weekdays: [1, 2, 3, 4, 5] }
    assert.deepEqual(scheduleFromVisual(weekly), { kind: 'cron', expr: '30 9 * * 1-5' })
    assert.deepEqual(visualFromSchedule({ kind: 'cron', expr: '30 9 * * 1-5' }), weekly)

    const monthly = { mode: 'monthly' as const, hour: 8, minute: 0, day: 1 }
    assert.deepEqual(scheduleFromVisual(monthly), { kind: 'cron', expr: '0 8 1 * *' })
    assert.deepEqual(visualFromSchedule({ kind: 'cron', expr: '0 8 1 * *' }), monthly)

    const hourly = { mode: 'hourly' as const, everyHours: 2 }
    assert.deepEqual(scheduleFromVisual(hourly), { kind: 'cron', expr: '0 */2 * * *' })
    assert.deepEqual(visualFromSchedule({ kind: 'cron', expr: '0 */2 * * *' }), hourly)
    assert.deepEqual(visualFromSchedule({ kind: 'cron', expr: '0 * * * *' }), {
      mode: 'hourly',
      everyHours: 1
    })

    const at = Date.parse('2026-09-07T10:00:00')
    assert.deepEqual(visualFromSchedule({ kind: 'once', at }), { mode: 'once', at })
  })

  it('maps a legacy interval onto hourly or the daily default', () => {
    assert.deepEqual(visualFromSchedule({ kind: 'interval', everyMs: 2 * 60 * 60 * 1000 }), {
      mode: 'hourly',
      everyHours: 2
    })
    assert.deepEqual(visualFromSchedule({ kind: 'interval', everyMs: 60_000 }), defaultVisualSchedule())
  })

  it('keeps at least one weekday selected', () => {
    assert.deepEqual(toggleWeekday([1], 1), [1])
    assert.deepEqual(toggleWeekday([1, 3], 3), [1])
  })
})
