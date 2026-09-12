import type { ConversationMeta } from '@shared/types'
import type { TimerSchedule } from '@shared/timer'
import { visualFromSchedule } from '@shared/cronUi'
import { isDraftScheduledTitle } from './draftEditorTitle'
import { getResolvedLocale } from '../i18n/useT'

function sortTimerSessions(a: ConversationMeta, b: ConversationMeta): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.pinned && b.pinned) return (b.pinTime ?? 0) - (a.pinTime ?? 0)
  return (b.timerRunAt ?? b.updatedAt) - (a.timerRunAt ?? a.updatedAt)
}

/** Finished / recently touched schedules float to the top; selection stays by id. */
export function sortTimerJobs<T extends { updatedAt: number }>(jobs: readonly T[]): T[] {
  return [...jobs].sort((a, b) => b.updatedAt - a.updatedAt)
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

/**
 * Fired run conversations whose schedule (job) no longer exists — the job file
 * was wiped, or the run was mirrored from a store the desktop no longer reads.
 * Without this they render as top-level siblings ("并列") because no parent row
 * claims them; grouping them keeps the tree honest and the runs reachable.
 */
export function orphanTimerSessions(
  conversations: ConversationMeta[],
  jobIds: Iterable<string>
): { live: ConversationMeta[]; archived: ConversationMeta[] } {
  const known = new Set(jobIds)
  const rows = conversations.filter(
    (row) =>
      row.sessionKind === 'timer' &&
      !!row.timerRunId &&
      (!row.timerJobId || !known.has(row.timerJobId))
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
  // Orphaned runs (no surviving job) list last so keyboard range-select reaches them.
  const { live: orphanLive } = orphanTimerSessions(
    conversations,
    jobs.map((job) => job.id)
  )
  for (const row of orphanLive) ids.push(row.id)
  return ids
}

/** Empty untitled job — still a real sidebar row after mint-on-create. */
export function isDraftTimerJob(
  job: { title: string; prompt: string; enabled: boolean },
  untitled: string
): boolean {
  return !job.enabled && !job.prompt.trim() && isDraftScheduledTitle(job.title, untitled)
}

export type TimerBracketKind = 'first' | 'mid' | 'last'

/**
 * The task → run tree in the sidebar. A schedule (task) is the parent row; its
 * fired runs are bracketed children so the relationship reads as nested, not as
 * side-by-side siblings. The collapsed archived toggle is a group header — not a
 * bracketed row — so it never continues the trunk: the last live / unmatched run
 * is the tree end when archived runs are hidden.
 */
export function timerTreeBrackets(counts: {
  live: number
  unmatched: number
  /** Archived runs currently visible (0 when the archived group is collapsed). */
  archivedShown: number
}): {
  hasTree: boolean
  bracketRowCount: number
  /** Bracket for the child at a flat index across live → unmatched → archived. */
  bracketAt: (index: number) => TimerBracketKind
} {
  const bracketRowCount = counts.live + counts.unmatched + counts.archivedShown
  return {
    hasTree: bracketRowCount > 0,
    bracketRowCount,
    bracketAt: (index: number): TimerBracketKind =>
      index === bracketRowCount - 1 ? 'last' : 'mid'
  }
}

/** Sidebar child label: the run's clock time, not the parent task name. */
export function timerRunTimeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString(getResolvedLocale(), {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
