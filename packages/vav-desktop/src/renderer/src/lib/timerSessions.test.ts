import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ConversationMeta } from '@shared/types'
import {
  isDraftTimerJob,
  orphanTimerSessions,
  sortTimerJobs,
  timerListConversationIds,
  timerRunTimeLabel,
  timerScheduleLabel,
  timerSessionsForJob,
  timerTreeBrackets
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

describe('orphanTimerSessions', () => {
  it('collects timer runs whose job is gone, skipping definitions and matched runs', () => {
    const rows = [
      row({ id: 'def', timerJobId: 'live', timerRunId: null }),
      row({ id: 'matched', timerJobId: 'live', timerRunId: 'r1', timerRunAt: 5 }),
      row({ id: 'gone', timerJobId: 'dead', timerRunId: 'r2', timerRunAt: 10 }),
      row({ id: 'nojob', timerJobId: null, timerRunId: 'r3', timerRunAt: 8 }),
      row({
        id: 'gone-arch',
        timerJobId: 'dead',
        timerRunId: 'r4',
        archived: true,
        archivedAt: 3
      }),
      row({ id: 'workspace', sessionKind: 'workspace', timerRunId: 'r5' })
    ]
    const { live, archived } = orphanTimerSessions(rows, ['live'])
    assert.deepEqual(
      live.map((c) => c.id),
      ['gone', 'nojob']
    )
    assert.deepEqual(
      archived.map((c) => c.id),
      ['gone-arch']
    )
  })

  it('is empty when every run still has its job', () => {
    const rows = [row({ id: 'run', timerJobId: 'a', timerRunId: 'r1' })]
    const { live, archived } = orphanTimerSessions(rows, ['a'])
    assert.equal(live.length + archived.length, 0)
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

describe('isDraftTimerJob', () => {
  it('detects empty untitled jobs', () => {
    const untitled = 'Untitled-scheduled-task'
    assert.equal(
      isDraftTimerJob({ title: untitled, prompt: '', enabled: false }, untitled),
      true
    )
    assert.equal(
      isDraftTimerJob({ title: untitled, prompt: 'do work', enabled: false }, untitled),
      false
    )
    assert.equal(
      isDraftTimerJob({ title: 'Nightly', prompt: '', enabled: false }, untitled),
      false
    )
  })
})

describe('timerTreeBrackets', () => {
  it('nests runs under the task and ends the trunk at the last run', () => {
    const tree = timerTreeBrackets({ live: 2, unmatched: 1, archivedShown: 0 })
    assert.equal(tree.hasTree, true)
    assert.equal(tree.bracketRowCount, 3)
    assert.deepEqual(
      [tree.bracketAt(0), tree.bracketAt(1), tree.bracketAt(2)],
      ['mid', 'mid', 'last']
    )
  })

  it('keeps the last live run as the trunk end when archived is collapsed', () => {
    const tree = timerTreeBrackets({ live: 1, unmatched: 0, archivedShown: 0 })
    assert.equal(tree.bracketAt(0), 'last')
  })

  it('extends the trunk through expanded archived runs', () => {
    const tree = timerTreeBrackets({ live: 1, unmatched: 0, archivedShown: 2 })
    assert.equal(tree.bracketRowCount, 3)
    assert.deepEqual(
      [tree.bracketAt(0), tree.bracketAt(1), tree.bracketAt(2)],
      ['mid', 'mid', 'last']
    )
  })

  it('draws no tree when a task has no runs', () => {
    assert.equal(timerTreeBrackets({ live: 0, unmatched: 0, archivedShown: 0 }).hasTree, false)
  })
})

describe('timerRunTimeLabel', () => {
  it('prints a clock time instead of the parent task name', () => {
    const label = timerRunTimeLabel(Date.parse('2026-03-08T15:04:00'))
    assert.match(label, /15:04|3:04/)
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

  it('appends orphaned runs so range-select reaches them', () => {
    const jobs = [{ id: 'a', conversationId: 'def-a' }]
    const rows = [
      row({ id: 'run-a', timerJobId: 'a', timerRunId: 'r1', timerRunAt: 2 }),
      row({ id: 'orphan', timerJobId: 'dead', timerRunId: 'r9', timerRunAt: 4 })
    ]
    assert.deepEqual(timerListConversationIds(jobs, rows), ['def-a', 'run-a', 'orphan'])
  })
})
