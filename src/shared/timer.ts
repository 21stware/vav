/** Scheduled jobs and the timer sessions they mint. */

export type TimerSchedule =
  | { kind: 'interval'; everyMs: number }
  | { kind: 'once'; at: number }

export type TimerRunStatus = 'running' | 'done' | 'error' | 'missed'

export interface TimerJob {
  id: string
  title: string
  prompt: string
  schedule: TimerSchedule
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastRunAt: number | null
  nextRunAt: number | null
}

export interface TimerRun {
  id: string
  jobId: string
  sessionId: string
  workdir: string
  startedAt: number
  endedAt: number | null
  status: TimerRunStatus
  outputPath: string | null
}

/** One row in the sidebar “Show timer sessions” list (parallel to file sessions). */
export interface TimerSessionListEntry {
  jobId: string
  jobTitle: string
  sessionId: string
  title: string
  workdir: string
  startedAt: number
  endedAt: number | null
  status: TimerRunStatus
  outputPath: string | null
  updatedAt: number
}

export const TIMER_OUTPUT_FILE = 'OUTPUT.md'

export function formatTimerStamp(at: number): string {
  const d = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

export function nextTimerDue(job: Pick<TimerJob, 'schedule' | 'lastRunAt'>, now: number): number | null {
  if (job.schedule.kind === 'once') {
    if (job.lastRunAt != null) return null
    return job.schedule.at
  }
  const every = Math.max(1_000, job.schedule.everyMs)
  if (job.lastRunAt == null) return now
  return job.lastRunAt + every
}

export function timerJobDraft(input: {
  title: string
  prompt: string
  everyMinutes?: number
  at?: number
  now?: number
}): Omit<TimerJob, 'id'> {
  const now = input.now ?? Date.now()
  const title = input.title.trim() || 'Timer'
  const prompt = input.prompt.trim()
  const schedule: TimerSchedule =
    input.at != null
      ? { kind: 'once', at: input.at }
      : { kind: 'interval', everyMs: Math.max(1, input.everyMinutes ?? 60) * 60_000 }
  const nextRunAt = nextTimerDue({ schedule, lastRunAt: null }, now)
  return {
    title,
    prompt,
    schedule,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    nextRunAt
  }
}
