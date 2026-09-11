/**
 * Scheduled tasks. The user writes the prompt in the definition conversation
 * (right panel) and sets the period there. Each fire uses the job workspace
 * (new temp, sticky temp, or a chosen folder) and a run conversation under
 * that schedule — never in the main project list. Jobs live in ~/.vav-server
 * so a running vav-server can fire them.
 */
import type { ConnectorId } from './connector.ts'

export type TimerScheduleKind = 'cron' | 'interval' | 'once'

export type TimerSchedule =
  | { kind: 'cron'; expr: string }
  | { kind: 'interval'; everyMs: number }
  | { kind: 'once'; at: number }

export type TimerRunStatus = 'running' | 'done' | 'failed' | 'skipped'

export interface TimerJob {
  id: string
  title: string
  prompt: string
  schedule: TimerSchedule
  enabled: boolean
  /** Conversation where the user writes the task and sets the schedule. */
  conversationId: string | null
  /**
   * `mint` — new temp folder every run.
   * `sticky` — one temp folder reused for this job.
   * `source` — `sourceWorkdir` (picked or recent folder).
   */
  workdirPolicy: 'mint' | 'sticky' | 'source'
  sourceWorkdir: string | null
  connectorIds: ConnectorId[]
  createdAt: number
  updatedAt: number
  lastRunAt: number | null
  nextRunAt: number | null
  lastStatus: 'ok' | 'failed' | 'running' | null
}

export interface TimerRun {
  id: string
  jobId: string
  conversationId: string
  startedAt: number
  finishedAt: number | null
  status: TimerRunStatus
  workdir: string
  outputPath: string | null
  error: string | null
}

export interface TimerJobInput {
  title: string
  prompt: string
  schedule: TimerSchedule
  enabled?: boolean
  conversationId?: string | null
  workdirPolicy?: 'mint' | 'sticky' | 'source'
  sourceWorkdir?: string | null
  connectorIds?: ConnectorId[]
}

export const TIMER_OUTPUT_FILE = 'output.md'
export const TIMER_BRIEF_FILE = 'brief.md'

const CRON_FIELD = /^(\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?$/

export function parseCronExpr(expr: string): [string, string, string, string, string] | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  if (!parts.every((part) => CRON_FIELD.test(part))) return null
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!, parts[4]!]
}

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  const [range, stepRaw] = field.split('/')
  const step = stepRaw ? Number(stepRaw) : 1
  if (!Number.isFinite(step) || step < 1) return false
  if (range === '*') return (value - min) % step === 0
  return range!.split(',').some((token) => {
    const [loRaw, hiRaw] = token.split('-')
    const lo = Number(loRaw)
    const hi = hiRaw === undefined ? lo : Number(hiRaw)
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false
    if (lo < min || hi > max || lo > hi) return false
    if (value < lo || value > hi) return false
    return (value - lo) % step === 0
  })
}

export function cronMatches(expr: string, at: Date): boolean {
  const parsed = parseCronExpr(expr)
  if (!parsed) return false
  const [minute, hour, day, month, weekday] = parsed
  return (
    fieldMatches(minute, at.getMinutes(), 0, 59) &&
    fieldMatches(hour, at.getHours(), 0, 23) &&
    fieldMatches(day, at.getDate(), 1, 31) &&
    fieldMatches(month, at.getMonth() + 1, 1, 12) &&
    fieldMatches(weekday, at.getDay(), 0, 6)
  )
}

/** Next fire time at or after `fromMs` (minute granularity for cron). */
export function nextTimerRunAt(schedule: TimerSchedule, fromMs: number): number | null {
  if (schedule.kind === 'once') {
    return schedule.at >= fromMs ? schedule.at : null
  }
  if (schedule.kind === 'interval') {
    const every = Math.max(60_000, Math.floor(schedule.everyMs))
    return fromMs + every
  }
  if (!parseCronExpr(schedule.expr)) return null
  const start = new Date(fromMs)
  start.setSeconds(0, 0)
  let cursor = start.getTime()
  if (cursor < fromMs) cursor += 60_000
  const limit = cursor + 366 * 24 * 60 * 60 * 1000
  while (cursor <= limit) {
    if (cronMatches(schedule.expr, new Date(cursor))) return cursor
    cursor += 60_000
  }
  return null
}

/** Compact schedule label for lists (not localized). */
export function formatTimerSchedule(schedule: TimerSchedule): string {
  if (schedule.kind === 'cron') return schedule.expr
  if (schedule.kind === 'interval') {
    const minutes = Math.max(1, Math.round(schedule.everyMs / 60_000))
    if (minutes % 60 === 0) {
      const hours = minutes / 60
      return hours === 1 ? 'every 1h' : `every ${hours}h`
    }
    return minutes === 1 ? 'every 1m' : `every ${minutes}m`
  }
  return new Date(schedule.at).toISOString()
}

export function formatTimerStamp(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function coerceTimerSchedule(raw: unknown): TimerSchedule | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (row.kind === 'cron' && typeof row.expr === 'string' && parseCronExpr(row.expr)) {
    return { kind: 'cron', expr: row.expr.trim() }
  }
  if (row.kind === 'interval' && typeof row.everyMs === 'number' && row.everyMs >= 60_000) {
    return { kind: 'interval', everyMs: Math.floor(row.everyMs) }
  }
  if (row.kind === 'once' && typeof row.at === 'number' && Number.isFinite(row.at)) {
    return { kind: 'once', at: row.at }
  }
  return null
}

export function coerceTimerWorkdirPolicy(raw: unknown): TimerJob['workdirPolicy'] {
  if (raw === 'source' || raw === 'sticky' || raw === 'mint') return raw
  return 'mint'
}
