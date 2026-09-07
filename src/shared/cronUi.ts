import type { TimerSchedule } from './timer.ts'
import { parseCronExpr } from './timer.ts'

export type VisualRepeat = 'hourly' | 'daily' | 'weekly' | 'monthly'

export type VisualSchedule =
  | { mode: 'once'; at: number }
  | { mode: 'hourly'; everyHours: number }
  | { mode: 'daily'; hour: number; minute: number }
  | { mode: 'weekly'; hour: number; minute: number; weekdays: number[] }
  | { mode: 'monthly'; hour: number; minute: number; day: number }

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const

export function clampHour(value: number): number {
  return Math.min(23, Math.max(0, Math.floor(value)))
}

export function clampMinute(value: number): number {
  return Math.min(59, Math.max(0, Math.floor(value)))
}

export function clampMonthDay(value: number): number {
  return Math.min(31, Math.max(1, Math.floor(value)))
}

export function clampEveryHours(value: number): number {
  return Math.min(12, Math.max(1, Math.floor(value)))
}

export function defaultVisualSchedule(): VisualSchedule {
  return { mode: 'daily', hour: 9, minute: 0 }
}

export function defaultOnceAt(now = Date.now()): number {
  return now + 60 * 60 * 1000
}

function parseListField(field: string, min: number, max: number): number[] | null {
  if (field === '*') return null
  const [range, stepRaw] = field.split('/')
  if (stepRaw) return null
  const values: number[] = []
  for (const token of range!.split(',')) {
    const [loRaw, hiRaw] = token.split('-')
    const lo = Number(loRaw)
    const hi = hiRaw === undefined ? lo : Number(hiRaw)
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < min || hi > max || lo > hi) return null
    for (let n = lo; n <= hi; n++) values.push(n)
  }
  return [...new Set(values)].sort((a, b) => a - b)
}

function encodeWeekdays(days: number[]): string {
  const unique = [...new Set(days.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b)
  if (unique.length === 0) return '1-5'
  if (unique.length === 1) return String(unique[0])
  const consecutive = unique.every((d, i) => i === 0 || d === unique[i - 1]! + 1)
  return consecutive ? `${unique[0]}-${unique[unique.length - 1]}` : unique.join(',')
}

export function scheduleFromVisual(visual: VisualSchedule): TimerSchedule {
  if (visual.mode === 'once') return { kind: 'once', at: visual.at }
  if (visual.mode === 'hourly') {
    const hours = clampEveryHours(visual.everyHours)
    return { kind: 'cron', expr: hours === 1 ? '0 * * * *' : `0 */${hours} * * *` }
  }
  const hour = clampHour(visual.hour)
  const minute = clampMinute(visual.minute)
  if (visual.mode === 'daily') return { kind: 'cron', expr: `${minute} ${hour} * * *` }
  if (visual.mode === 'monthly') {
    return { kind: 'cron', expr: `${minute} ${hour} ${clampMonthDay(visual.day)} * *` }
  }
  return { kind: 'cron', expr: `${minute} ${hour} * * ${encodeWeekdays(visual.weekdays)}` }
}

export function visualFromSchedule(schedule: TimerSchedule): VisualSchedule {
  if (schedule.kind === 'once') return { mode: 'once', at: schedule.at }
  if (schedule.kind === 'interval') {
    const hours = Math.max(1, Math.round(schedule.everyMs / 3_600_000))
    if (hours <= 12 && schedule.everyMs >= 3_600_000) {
      return { mode: 'hourly', everyHours: clampEveryHours(hours) }
    }
    return defaultVisualSchedule()
  }
  const parsed = parseCronExpr(schedule.expr)
  if (!parsed) return defaultVisualSchedule()
  const [minuteField, hourField, dayField, monthField, weekdayField] = parsed
  if (monthField !== '*') return defaultVisualSchedule()

  const minute = minuteField === '*' ? 0 : Number(minuteField)
  if (!Number.isFinite(minute)) return defaultVisualSchedule()

  if (hourField.startsWith('*/') && dayField === '*' && weekdayField === '*') {
    const hours = Number(hourField.slice(2))
    if (Number.isFinite(hours) && hours >= 1 && hours <= 12 && minute === 0) {
      return { mode: 'hourly', everyHours: clampEveryHours(hours) }
    }
  }
  if (hourField === '*' && dayField === '*' && weekdayField === '*' && minute === 0) {
    return { mode: 'hourly', everyHours: 1 }
  }

  const hour = Number(hourField)
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return defaultVisualSchedule()

  if (dayField !== '*' && weekdayField === '*') {
    const day = Number(dayField)
    if (!Number.isFinite(day)) return defaultVisualSchedule()
    return { mode: 'monthly', hour, minute, day: clampMonthDay(day) }
  }

  if (weekdayField !== '*' && dayField === '*') {
    const weekdays = parseListField(weekdayField, 0, 6) ?? [1, 2, 3, 4, 5]
    return { mode: 'weekly', hour, minute, weekdays }
  }

  if (dayField === '*' && weekdayField === '*') {
    return { mode: 'daily', hour, minute }
  }
  return defaultVisualSchedule()
}

export function visualWeekdays(): readonly number[] {
  return WEEKDAYS
}

export function toggleWeekday(weekdays: number[], day: number): number[] {
  const next = weekdays.includes(day) ? weekdays.filter((d) => d !== day) : [...weekdays, day]
  return next.length === 0 ? [day] : next.sort((a, b) => a - b)
}
