import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  primaryQuotaWindow,
  weekTokensFromConversations,
  weekTurnTokens,
  weekUsageSpark,
  weekUsageTurns,
  workbenchLibraryCounts
} from './workbenchHomeStats.ts'
import type { AnalysisTurnRow } from '@shared/analysis'
import type { QuotaWindow } from '@shared/types'

function window(kind: QuotaWindow['kind']): QuotaWindow {
  return { id: kind, kind, usedPercent: 40, resetsAt: null, updatedAt: 1 }
}

function turn(partial: Partial<AnalysisTurnRow> & { timestamp: number }): AnalysisTurnRow {
  return {
    hostKey: 'vav',
    model: 'sonnet',
    accountId: 'a',
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    costApprox: false,
    failed: false,
    ...partial
  }
}

describe('workbenchHomeStats', () => {
  it('prefers the weekly quota window', () => {
    const picked = primaryQuotaWindow([window('five_hour'), window('seven_day')])
    assert.equal(picked?.kind, 'seven_day')
  })

  it('counts notes, storage files, and data objects', () => {
    assert.deepEqual(
      workbenchLibraryCounts([
        { sessionKind: 'knowledge' },
        { sessionKind: 'knowledge', archived: true },
        { sessionKind: 'file' },
        { fileId: 'ino-1' },
        { sessionKind: 'db' },
        { sessionKind: 'workspace' }
      ]),
      { notes: 1, storage: 2, data: 1 }
    )
  })

  it('scopes week turns and sums tokens', () => {
    const now = Date.parse('2026-09-21T12:00:00')
    const turns = [
      turn({ timestamp: now - 2 * 86400000, inputTokens: 80, outputTokens: 20 }),
      turn({ timestamp: now - 10 * 86400000, inputTokens: 999, outputTokens: 1 })
    ]
    const week = weekUsageTurns(turns, now)
    assert.equal(week.length, 1)
    assert.equal(weekTurnTokens(week), 100)
  })

  it('builds a 7-day spark from local midnights', () => {
    const now = Date.parse('2026-09-21T15:00:00')
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const today = start.getTime()
    const spark = weekUsageSpark(
      [
        turn({ timestamp: today + 3600000, inputTokens: 50, outputTokens: 0 }),
        turn({ timestamp: today - 86400000, inputTokens: 10, outputTokens: 0 })
      ],
      now
    )
    assert.equal(spark.length, 7)
    assert.equal(spark[5], 10)
    assert.equal(spark[6], 50)
  })

  it('falls back to conversation tokens touched this week', () => {
    const now = 1_000_000_000
    assert.equal(
      weekTokensFromConversations(
        [
          { sessionKind: 'workspace', tokensUsed: 40, updatedAt: now },
          { sessionKind: 'workspace', tokensUsed: 9, updatedAt: now - 10 * 86400000 },
          { sessionKind: 'knowledge', tokensUsed: 80, updatedAt: now }
        ],
        now
      ),
      40
    )
  })
})
