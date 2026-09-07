import type { ConversationMeta } from '@shared/types'
import type { TimerSchedule } from '@shared/timer'
import { visualFromSchedule } from '@shared/cronUi'

function sortTimerSessions(a: ConversationMeta, b: ConversationMeta): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.pinned && b.pinned) return (b.pinTime ?? 0) - (a.pinTime ?? 0)
  return (b.timerRunAt ?? b.updatedAt) - (a.timerRunAt ?? a.updatedAt)
}

/** Fired run conversations for one schedule. Definition chats are excluded. */
export function timerSessionsForJob(
  conversations: ConversationMeta[],
  jobId: string
): { live: ConversationMeta[]; archived: ConversationMeta[] } {
  const rows = conversations.filter(
    (row) => row.sessionKind === 'timer' && row.timerJobId === jobId && !!row.timerRunId
  )
  return {
    live: rows.filter((row) => !row.archived).sort(sortTimerSessions),
    archived: rows.filter((row) => row.archived).sort(sortTimerSessions)
  }
}

function padTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function timerScheduleLabel(
  schedule: TimerSchedule,
  weekday: (day: number) => string
): string {
  const visual = visualFromSchedule(schedule)
  if (visual.mode === 'once') return new Date(visual.at).toLocaleString()
  if (visual.mode === 'hourly') return visual.everyHours === 1 ? '1h' : `${visual.everyHours}h`
  if (visual.mode === 'daily') return padTime(visual.hour, visual.minute)
  if (visual.mode === 'weekly') {
    return `${visual.weekdays.map(weekday).join('')} ${padTime(visual.hour, visual.minute)}`
  }
  return `${visual.day} · ${padTime(visual.hour, visual.minute)}`
}

export function timerListConversationIds(
  jobs: Array<{ id: string; conversationId?: string | null }>,
  conversations: ConversationMeta[]
): string[] {
  const ids: string[] = []
  for (const job of jobs) {
    if (job.conversationId) ids.push(job.conversationId)
    const { live } = timerSessionsForJob(conversations, job.id)
    for (const row of live) ids.push(row.id)
  }
  return ids
}
