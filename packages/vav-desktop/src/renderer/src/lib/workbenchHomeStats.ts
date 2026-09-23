import { analysisSinceMs, type AnalysisTurnRow } from '@shared/analysis'
import type { QuotaWindow, QuotaWindowKind } from '@shared/types'
import {
  isDbSession,
  isKnowledgeSession,
  sessionKindOf,
  type SessionKind
} from '@shared/sessionKind'

const DAY_MS = 24 * 60 * 60 * 1000
const SPARK_DAYS = 7

const QUOTA_PREFER: QuotaWindowKind[] = [
  'seven_day',
  'seven_day_sonnet',
  'seven_day_opus',
  'monthly',
  'five_hour',
  'cursor_api',
  'cursor_auto'
]

export type LibraryRow = {
  archived?: boolean
  fileId?: string | null
  sessionKind?: SessionKind | null
  tokensUsed?: number
  updatedAt?: number
}

export function startOfLocalDay(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function primaryQuotaWindow(windows: QuotaWindow[]): QuotaWindow | null {
  if (windows.length === 0) return null
  for (const kind of QUOTA_PREFER) {
    const match = windows.find((row) => row.kind === kind)
    if (match) return match
  }
  return windows[0] ?? null
}

export function workbenchLibraryCounts(rows: LibraryRow[]): {
  notes: number
  storage: number
  data: number
} {
  let notes = 0
  let storage = 0
  let data = 0
  for (const row of rows) {
    if (row.archived) continue
    if (isKnowledgeSession(row)) notes += 1
    else if (sessionKindOf(row) === 'file' || row.fileId) storage += 1
    else if (isDbSession(row)) data += 1
  }
  return { notes, storage, data }
}

export function weekTurnTokens(turns: AnalysisTurnRow[]): number {
  let total = 0
  for (const turn of turns) {
    total +=
      turn.inputTokens + turn.outputTokens + turn.cacheReadTokens + turn.cacheWriteTokens
  }
  return total
}

export function weekUsageTurns(turns: AnalysisTurnRow[], now: number): AnalysisTurnRow[] {
  return turns.filter((turn) => turn.timestamp >= (analysisSinceMs('7d', now) ?? 0))
}

export function weekUsageSpark(turns: AnalysisTurnRow[], now: number): number[] {
  const buckets = Array.from({ length: SPARK_DAYS }, () => 0)
  const start = startOfLocalDay(now) - (SPARK_DAYS - 1) * DAY_MS
  for (const turn of turns) {
    const index = Math.floor((turn.timestamp - start) / DAY_MS)
    if (index < 0 || index >= SPARK_DAYS) continue
    buckets[index] +=
      turn.inputTokens + turn.outputTokens + turn.cacheReadTokens + turn.cacheWriteTokens
  }
  return buckets
}

/** Lifetime tokens on workspace rows touched this week — analysis fallback. */
export function weekTokensFromConversations(rows: LibraryRow[], now: number): number {
  const since = now - 7 * DAY_MS
  let total = 0
  for (const row of rows) {
    if (row.archived) continue
    if ((row.updatedAt ?? 0) < since) continue
    if (sessionKindOf(row) !== 'workspace' && sessionKindOf(row) !== 'file') continue
    total += row.tokensUsed ?? 0
  }
  return total
}
