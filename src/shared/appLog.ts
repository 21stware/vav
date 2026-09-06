/**
 * Diagnostic log model for vav.
 *
 * Three retention classes keep debug value without turning userData into a
 * dump of every token and every keystroke:
 *
 * - **ephemeral** — in-memory only, 15 minutes. High-frequency noise
 *   (phase, usage samples, settings-nav). Gone on quit.
 * - **session** — on disk, 24 hours or until the conversation is deleted.
 *   Turn start/end, tool cards, awaiting. Answers "what happened in this chat?"
 * - **durable** — on disk, user-configurable 1–30 days (default 7). Errors,
 *   send/cancel, crashes. Survives session deletion for post-mortem.
 */

export const LOG_CHANNELS = ['user', 'agent', 'system'] as const
export type LogChannel = (typeof LOG_CHANNELS)[number]

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export const LOG_RETENTION_CLASSES = ['ephemeral', 'session', 'durable'] as const
export type LogRetentionClass = (typeof LOG_RETENTION_CLASSES)[number]

export const LOG_RETENTION_DAYS = [1, 3, 7, 14, 30] as const
export type LogRetentionDays = (typeof LOG_RETENTION_DAYS)[number]
export const DEFAULT_LOG_RETENTION_DAYS: LogRetentionDays = 7

export const EPHEMERAL_TTL_MS = 15 * 60_000
export const SESSION_TTL_MS = 24 * 60 * 60_000

export const MAX_LOG_RECORDS = {
  ephemeral: 2_000,
  session: 8_000,
  durable: 20_000
} as const

export const MAX_LOG_MESSAGE_CHARS = 400
export const MAX_LOG_EVENT_CHARS = 80
export const MAX_LOG_DATA_JSON_CHARS = 2_000
export const MAX_LOG_STRING_FIELD_CHARS = 400
export const MAX_LOG_QUERY_LIMIT = 500
export const DEFAULT_LOG_QUERY_LIMIT = 200

export const LOG_EVENT = {
  userSend: 'user.send',
  userCancel: 'user.cancel',
  userAnswer: 'user.answer',
  userRegenerate: 'user.regenerate',
  userEdit: 'user.edit',
  userFork: 'user.fork',
  userSessionCreate: 'user.session.create',
  userSessionRemove: 'user.session.remove',
  userSettingsUpdate: 'user.settings.update',
  userSettingsNav: 'user.settings.nav',
  agentTurnStart: 'agent.turn.start',
  agentTurnEnd: 'agent.turn.end',
  agentTurnPhase: 'agent.turn.phase',
  agentTool: 'agent.tool',
  agentAwaiting: 'agent.awaiting',
  agentUsage: 'agent.usage',
  agentCliSession: 'agent.cli-session',
  systemBoot: 'system.boot',
  systemQuit: 'system.quit',
  systemUncaught: 'system.uncaught',
  systemUnhandled: 'system.unhandled'
} as const

export type AppLogRecord = {
  id: string
  ts: number
  channel: LogChannel
  level: LogLevel
  event: string
  retention: LogRetentionClass
  conversationId?: string
  message: string
  data?: Record<string, unknown>
}

export type AppLogInput = {
  channel: LogChannel
  level?: LogLevel
  event: string
  message: string
  retention?: LogRetentionClass
  conversationId?: string
  data?: Record<string, unknown>
}

export type AppLogQuery = {
  channel?: LogChannel | 'all'
  retention?: LogRetentionClass | 'all'
  conversationId?: string
  search?: string
  since?: number
  until?: number
  limit?: number
}

export type AppLogClearScope = LogRetentionClass | 'all'

export type AppLogStats = {
  ephemeral: number
  session: number
  durable: number
  total: number
}

const SECRET_KEY =
  /(?:^|_|-)(?:api[_-]?key|(?:api|access|refresh|id)?[_-]?tokens?|secret|password|passwd|authorization|cookie|pairing|credential|private[_-]?key)$/i
const SECRET_VALUE = /^(?:sk-|xai-|sk-ant-|oat_|Bearer\s)/i

export function isLogChannel(value: unknown): value is LogChannel {
  return LOG_CHANNELS.includes(value as LogChannel)
}

export function isLogLevel(value: unknown): value is LogLevel {
  return LOG_LEVELS.includes(value as LogLevel)
}

export function isLogRetentionClass(value: unknown): value is LogRetentionClass {
  return LOG_RETENTION_CLASSES.includes(value as LogRetentionClass)
}

export function clampLogRetentionDays(value: unknown): LogRetentionDays {
  const n = typeof value === 'number' ? value : Number(value)
  if (LOG_RETENTION_DAYS.includes(n as LogRetentionDays)) return n as LogRetentionDays
  return DEFAULT_LOG_RETENTION_DAYS
}

export function defaultRetentionFor(
  channel: LogChannel,
  level: LogLevel,
  event: string
): LogRetentionClass {
  if (level === 'error' || level === 'warn') return 'durable'
  if (level === 'debug') return 'ephemeral'
  if (channel === 'system') return 'durable'
  if (channel === 'user') {
    if (event === LOG_EVENT.userSettingsNav) return 'ephemeral'
    return 'durable'
  }
  if (
    event === LOG_EVENT.agentTurnPhase ||
    event === LOG_EVENT.agentUsage ||
    event === LOG_EVENT.agentCliSession
  ) {
    return 'ephemeral'
  }
  return 'session'
}

export function ttlMsFor(retention: LogRetentionClass, durableDays: number): number {
  if (retention === 'ephemeral') return EPHEMERAL_TTL_MS
  if (retention === 'session') return SESSION_TTL_MS
  const days = clampLogRetentionDays(durableDays)
  return days * 24 * 60 * 60_000
}

export function isLogExpired(
  record: Pick<AppLogRecord, 'ts' | 'retention'>,
  now: number,
  durableDays: number
): boolean {
  return now - record.ts > ttlMsFor(record.retention, durableDays)
}

export function pruneLogRecords(
  records: AppLogRecord[],
  now: number,
  durableDays: number,
  maxByClass: typeof MAX_LOG_RECORDS = MAX_LOG_RECORDS
): AppLogRecord[] {
  const kept = records.filter((row) => !isLogExpired(row, now, durableDays))
  const buckets: Record<LogRetentionClass, AppLogRecord[]> = {
    ephemeral: [],
    session: [],
    durable: []
  }
  for (const row of kept) buckets[row.retention].push(row)
  const out: AppLogRecord[] = []
  for (const cls of LOG_RETENTION_CLASSES) {
    const list = buckets[cls]
    const max = maxByClass[cls]
    if (list.length <= max) {
      out.push(...list)
      continue
    }
    list.sort((a, b) => a.ts - b.ts)
    out.push(...list.slice(list.length - max))
  }
  return out
}

export function truncateLogText(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

export function redactLogData(data: unknown): Record<string, unknown> | undefined {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return undefined
  const out = redactUnknown(data, 0)
  if (!out || typeof out !== 'object' || Array.isArray(out)) return undefined
  const json = JSON.stringify(out)
  if (!json || json === '{}') return undefined
  if (json.length <= MAX_LOG_DATA_JSON_CHARS) return out as Record<string, unknown>
  return { truncated: true, preview: truncateLogText(json, MAX_LOG_DATA_JSON_CHARS) }
}

function redactUnknown(value: unknown, depth: number): unknown {
  if (value == null) return value
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) return '[redacted]'
    return truncateLogText(value, MAX_LOG_STRING_FIELD_CHARS)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value !== 'object') return String(value)
  if (depth >= 4) return '[…]'
  if (Array.isArray(value)) {
    return value.slice(0, 16).map((item) => redactUnknown(item, depth + 1))
  }
  const out: Record<string, unknown> = {}
  let n = 0
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (n >= 24) {
      out._omitted = true
      break
    }
    n += 1
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : redactUnknown(item, depth + 1)
  }
  return out
}

export function sanitizeLogInput(
  input: AppLogInput,
  now: number,
  id: string
): AppLogRecord | null {
  if (!isLogChannel(input.channel)) return null
  const event = truncateLogText(String(input.event ?? '').trim(), MAX_LOG_EVENT_CHARS)
  if (!event) return null
  const level: LogLevel = isLogLevel(input.level) ? input.level : 'info'
  const retention = isLogRetentionClass(input.retention)
    ? input.retention
    : defaultRetentionFor(input.channel, level, event)
  const conversationId =
    typeof input.conversationId === 'string' && input.conversationId.trim()
      ? input.conversationId.trim()
      : undefined
  const record: AppLogRecord = {
    id,
    ts: now,
    channel: input.channel,
    level,
    event,
    retention,
    message: truncateLogText(String(input.message ?? ''), MAX_LOG_MESSAGE_CHARS),
    ...(conversationId ? { conversationId } : {}),
    ...(redactLogData(input.data) ? { data: redactLogData(input.data) } : {})
  }
  return record
}

export function queryLogRecords(records: AppLogRecord[], query: AppLogQuery = {}): AppLogRecord[] {
  const channel = query.channel && query.channel !== 'all' ? query.channel : null
  const retention = query.retention && query.retention !== 'all' ? query.retention : null
  const conversationId = query.conversationId?.trim() || null
  const search = query.search?.trim().toLowerCase() || null
  const since = typeof query.since === 'number' ? query.since : null
  const until = typeof query.until === 'number' ? query.until : null
  const limit = Math.min(
    MAX_LOG_QUERY_LIMIT,
    Math.max(1, Math.round(query.limit ?? DEFAULT_LOG_QUERY_LIMIT))
  )
  const matched = records.filter((row) => {
    if (channel && row.channel !== channel) return false
    if (retention && row.retention !== retention) return false
    if (conversationId && row.conversationId !== conversationId) return false
    if (since != null && row.ts < since) return false
    if (until != null && row.ts > until) return false
    if (search) {
      const hay = `${row.event} ${row.message} ${row.conversationId ?? ''} ${
        row.data ? JSON.stringify(row.data) : ''
      }`.toLowerCase()
      if (!hay.includes(search)) return false
    }
    return true
  })
  matched.sort((a, b) => b.ts - a.ts || b.id.localeCompare(a.id))
  return matched.slice(0, limit)
}

export function logStatsOf(records: AppLogRecord[]): AppLogStats {
  const stats: AppLogStats = { ephemeral: 0, session: 0, durable: 0, total: records.length }
  for (const row of records) stats[row.retention] += 1
  return stats
}

export function formatLogLine(record: AppLogRecord): string {
  const time = new Date(record.ts).toISOString()
  const conv = record.conversationId ? ` conv=${record.conversationId}` : ''
  const data = record.data ? ` ${JSON.stringify(record.data)}` : ''
  return `${time} ${record.channel}/${record.level} [${record.retention}] ${record.event} ${record.message}${conv}${data}`
}

export function parseLogRecord(raw: unknown): AppLogRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  if (!isLogChannel(row.channel) || !isLogLevel(row.level) || !isLogRetentionClass(row.retention)) {
    return null
  }
  if (typeof row.id !== 'string' || !row.id) return null
  if (typeof row.ts !== 'number' || !Number.isFinite(row.ts)) return null
  if (typeof row.event !== 'string' || !row.event) return null
  if (typeof row.message !== 'string') return null
  const conversationId =
    typeof row.conversationId === 'string' && row.conversationId.trim()
      ? row.conversationId
      : undefined
  const data =
    row.data && typeof row.data === 'object' && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : undefined
  return {
    id: row.id,
    ts: row.ts,
    channel: row.channel,
    level: row.level,
    event: row.event,
    retention: row.retention,
    message: row.message,
    ...(conversationId ? { conversationId } : {}),
    ...(data ? { data } : {})
  }
}
