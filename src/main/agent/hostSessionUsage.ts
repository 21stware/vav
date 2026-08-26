import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CliHostKind, ProviderResumeCursor } from '../../shared/cliHost.ts'
import { buildSnapshot, TOKEN_HISTORY_LIMIT } from '../../shared/tokenUsage.ts'
import type { Conversation, HostTranscriptBucket, TokenSnapshot } from '../../shared/types.ts'
import { encodeGrokSessionDir } from './hostSessionStore.ts'
import {
  readAcpUsageFromUpdate,
  type AcpUsageSample
} from './drivers/acpUsage.ts'

export type HostUsageImport = {
  history: TokenSnapshot[]
  tokensUsed: number
  reportedSessionCostUsd: number | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function resumeSessionId(cursor: ProviderResumeCursor | null | undefined): string | null {
  if (!cursor) return null
  if ('sessionId' in cursor && typeof cursor.sessionId === 'string' && cursor.sessionId.trim()) {
    return cursor.sessionId.trim()
  }
  return null
}

function grokHome(home: string): string {
  const env = process.env.GROK_HOME?.trim()
  return env || join(home, '.grok')
}

function timestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return timestampMs(n)
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return Date.now()
}

function snapshotFromSample(
  sample: AcpUsageSample,
  turnIndex: number,
  modelId: string,
  timestamp: number
): TokenSnapshot | null {
  const input = sample.inputTokens ?? 0
  const output = sample.outputTokens ?? 0
  const cacheRead = sample.cacheRead ?? 0
  const cacheWrite = sample.cacheWrite ?? 0
  if (input <= 0 && output <= 0 && cacheRead <= 0 && cacheWrite <= 0) return null
  return buildSnapshot({
    turnIndex,
    usage: { input, output, cacheRead, cacheWrite },
    modelId,
    timestamp,
    costUsd: sample.turnCostUsd
  })
}

/** Grok persists per-turn usage on `_x.ai/session/update` `turn_completed`. */
export function readGrokSessionUsage(
  sessionId: string,
  cwd: string,
  options?: { home?: string; modelId?: string }
): HostUsageImport | null {
  const id = sessionId.trim()
  const dir = cwd.trim()
  if (!id || !dir) return null
  const home = options?.home ?? homedir()
  const file = join(grokHome(home), 'sessions', encodeGrokSessionDir(dir), id, 'updates.jsonl')
  if (!existsSync(file)) return null
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const modelId = options?.modelId?.trim() || 'grok'
  const all: TokenSnapshot[] = []
  let sessionCost = 0
  let sawCost = false
  for (const line of text.split('\n')) {
    const raw = line.trim()
    if (!raw) continue
    let row: Record<string, unknown> | null = null
    try {
      row = asRecord(JSON.parse(raw))
    } catch {
      continue
    }
    if (!row) continue
    const params = asRecord(row.params) ?? row
    const update = asRecord(params.update) ?? params
    const kind = asString(update.sessionUpdate) || asString(update.session_update) || ''
    if (kind.replace(/[_-]/g, '').toLowerCase() !== 'turncompleted') continue
    if (!asRecord(update.usage) && update.inputTokens == null && update.used == null) continue
    const sample = readAcpUsageFromUpdate(update)
    if (!sample) continue
    const snap = snapshotFromSample(sample, all.length + 1, modelId, timestampMs(row.timestamp))
    if (!snap) continue
    all.push(snap)
    if (typeof sample.turnCostUsd === 'number' && Number.isFinite(sample.turnCostUsd)) {
      sessionCost += sample.turnCostUsd
      sawCost = true
    }
  }
  if (all.length === 0) return null
  const latest = all[all.length - 1]!
  return {
    history: all.slice(-TOKEN_HISTORY_LIMIT),
    tokensUsed: latest.totalInputTokens,
    reportedSessionCostUsd: sawCost ? sessionCost : null
  }
}

export function readHostSessionUsage(
  host: CliHostKind | null | undefined,
  sessionId: string | null | undefined,
  cwd: string | null | undefined,
  options?: { home?: string; modelId?: string }
): HostUsageImport | null {
  if (host !== 'grok') return null
  if (!sessionId || !cwd) return null
  return readGrokSessionUsage(sessionId, cwd, options)
}

function bucketHasUsage(history: TokenSnapshot[] | undefined, tokensUsed: number | undefined): boolean {
  return (history?.length ?? 0) > 0 || (tokensUsed ?? 0) > 0
}

function applyImport(
  target: { tokenHistory: TokenSnapshot[]; tokensUsed: number; reportedSessionCostUsd?: number | null },
  usage: HostUsageImport
): boolean {
  if (bucketHasUsage(target.tokenHistory, target.tokensUsed)) return false
  target.tokenHistory = usage.history
  target.tokensUsed = usage.tokensUsed
  if (usage.reportedSessionCostUsd != null) {
    target.reportedSessionCostUsd = usage.reportedSessionCostUsd
  }
  return true
}

/**
 * Fill empty token history from the host's on-disk session (Grok updates.jsonl).
 * Returns true when the conversation (or a parked bucket) changed.
 */
export function applyMissingHostUsage(
  conversation: Conversation,
  options?: { home?: string }
): boolean {
  const cwd = conversation.workingDirectory
  let changed = false
  const activeHost = conversation.cliHost ?? null
  const activeId = resumeSessionId(conversation.cliResumeCursor)
  if (activeHost && activeId && !bucketHasUsage(conversation.tokenHistory, conversation.tokensUsed)) {
    const usage = readHostSessionUsage(activeHost, activeId, cwd, {
      home: options?.home,
      modelId: conversation.model
    })
    if (usage && applyImport(conversation, usage)) changed = true
  }
  const parked = conversation.hostTranscripts
  if (!parked) return changed
  for (const [key, bucket] of Object.entries(parked) as Array<[string, HostTranscriptBucket]>) {
    if (!bucket || key === 'vav') continue
    if (bucketHasUsage(bucket.tokenHistory, bucket.tokensUsed)) continue
    const sessionId = resumeSessionId(bucket.cliResumeCursor)
    if (!sessionId) continue
    const usage = readHostSessionUsage(key as CliHostKind, sessionId, cwd, {
      home: options?.home,
      modelId: bucket.model ?? conversation.model
    })
    if (usage && applyImport(bucket, usage)) changed = true
  }
  return changed
}
