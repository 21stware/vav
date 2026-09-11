import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ConversationMeta } from '@shared/types'
import {
  sortTimerJobs,
  timerListConversationIds,
  timerScheduleLabel,
  timerSessionsForJob
} from './timerSessions.ts'

function row(partial: Partial<ConversationMeta> & { id: string }): ConversationMeta {
  return {
    title: partial.id,
    model: 'm',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    pinTime: null,
    archived: false,
    archivedAt: null,
    workingDirectory: null,
    tokensUsed: 0,
    approvalMode: 'auto',
    sessionKind: 'timer',
    ...partial
  } as ConversationMeta
}

describe('timerSessionsForJob', () => {
  it('lists live run sessions under a schedule, pinned first', () => {
    const rows = [
      row({ id: 'def', timerJobId: 'job', timerRunId: null, updatedAt: 9 }),
      row({ id: 'old', timerJobId: 'job', timerRunId: 'r1', timerRunAt: 10, updatedAt: 10 }),
      row({
        id: 'pin',
        timerJobId: 'job',
        timerRunId: 'r2',
        timerRunAt: 5,
        updatedAt: 5,
        pinned: true,
        pinTime: 20
      }),
      row({ id: 'arch', timerJobId: 'job', timerRunId: 'r3', archived: true, archivedAt: 8 }),
      row({ id: 'other', timerJobId: 'x', timerRunId: 'r4', updatedAt: 30 })
    ]
    const { live, archived } = timerSessionsForJob(rows, 'job')
    assert.deepEqual(
      live.map((c) => c.id),
      ['pin', 'old']
    )
    assert.deepEqual(
      archived.map((c) => c.id),
      ['arch']
    )
  })
})

describe('timerScheduleLabel', () => {
  it('prints a visual daily time instead of a cron comment', () => {
    const weekday = (day: number): string => '日一二三四五六'[day] ?? ''
    assert.equal(timerScheduleLabel({ kind: 'cron', expr: '0 9 * * *' }, weekday), '09:00')
    assert.equal(
      timerScheduleLabel({ kind: 'cron', expr: '30 9 * * 1-5' }, weekday),
      '一二三四五 09:30'
    )
  })
})

describe('sortTimerJobs', () => {
  it('moves a recently finished job to the top without depending on array index', () => {
    const ranked = sortTimerJobs([
      { id: 'older', updatedAt: 10 },
      { id: 'newer', updatedAt: 30 },
      { id: 'mid', updatedAt: 20 }
    ])
    assert.deepEqual(
      ranked.map((job) => job.id),
      ['newer', 'mid', 'older']
    )
  })
})

describe('timerListConversationIds', () => {
  it('walks definition then live run sessions', () => {
    const jobs = [
      { id: 'a', conversationId: 'def-a' },
      { id: 'b', conversationId: 'def-b' }
    ]
    const rows = [
      row({ id: 'run-a', timerJobId: 'a', timerRunId: 'r1', timerRunAt: 2 }),
      row({ id: 'run-b', timerJobId: 'b', timerRunId: 'r2', timerRunAt: 3 })
    ]
    assert.deepEqual(timerListConversationIds(jobs, rows), ['def-a', 'run-a', 'def-b', 'run-b'])
  })
})
