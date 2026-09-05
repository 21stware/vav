import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_LOG_RETENTION_DAYS,
  formatLogLine,
  logStatsOf,
  parseLogRecord,
  pruneLogRecords,
  queryLogRecords,
  sanitizeLogInput,
  type AppLogClearScope,
  type AppLogInput,
  type AppLogQuery,
  type AppLogRecord,
  type AppLogStats,
  type LogRetentionClass
} from '@shared/appLog'
import { createDebouncedWriter } from './debounceWrite.ts'

const SESSION_FILE = 'session.jsonl'
const DURABLE_FILE = 'durable.jsonl'

export type LogStoreOptions = {
  dir: string
  now?: () => number
  id?: () => string
  durableDays?: () => number
}

/**
 * Diagnostic log sink. Ephemeral records never touch disk.
 * Session / durable are JSONL under `userData/logs`.
 */
export class LogStore {
  private readonly dir: string
  private readonly now: () => number
  private readonly id: () => string
  private readonly durableDays: () => number
  private ephemeral: AppLogRecord[] = []
  private session: AppLogRecord[] = []
  private durable: AppLogRecord[] = []
  private persistWriter = createDebouncedWriter(() => this.writeFiles(), 200)
  onAppend: ((record: AppLogRecord) => void) | null = null

  constructor(opts: LogStoreOptions) {
    this.dir = opts.dir
    this.now = opts.now ?? Date.now
    this.id = opts.id ?? (() => randomUUID())
    this.durableDays = opts.durableDays ?? (() => DEFAULT_LOG_RETENTION_DAYS)
  }

  load(): void {
    this.session = this.readFile(join(this.dir, SESSION_FILE))
    this.durable = this.readFile(join(this.dir, DURABLE_FILE))
    this.ephemeral = []
    const before = this.session.length + this.durable.length
    this.prune()
    if (this.session.length + this.durable.length !== before) this.writeFiles()
  }

  append(input: AppLogInput): AppLogRecord | null {
    const record = sanitizeLogInput(input, this.now(), this.id())
    if (!record) return null
    this.bucket(record.retention).push(record)
    this.prune()
    if (record.retention !== 'ephemeral') this.persistWriter.schedule()
    this.onAppend?.(record)
    return record
  }

  query(query: AppLogQuery = {}): AppLogRecord[] {
    this.prune()
    return queryLogRecords(this.all(), query)
  }

  stats(): AppLogStats {
    this.prune()
    return logStatsOf(this.all())
  }

  clear(scope: AppLogClearScope): number {
    const before = this.all().length
    if (scope === 'all') {
      this.ephemeral = []
      this.session = []
      this.durable = []
    } else {
      this.replaceClass(scope, [])
    }
    const removed = before - this.all().length
    if (removed && scope !== 'ephemeral') this.writeFiles()
    return removed
  }

  /** Session + ephemeral rows for a deleted conversation. Durable stays. */
  removeForConversation(conversationId: string): number {
    const id = conversationId.trim()
    if (!id) return 0
    const before = this.ephemeral.length + this.session.length
    this.ephemeral = this.ephemeral.filter((row) => row.conversationId !== id)
    this.session = this.session.filter((row) => row.conversationId !== id)
    const removed = before - (this.ephemeral.length + this.session.length)
    if (removed) this.persistWriter.schedule()
    return removed
  }

  exportText(query: AppLogQuery = {}): string {
    const rows = this.query({ ...query, limit: query.limit ?? 500 })
    return rows
      .slice()
      .reverse()
      .map(formatLogLine)
      .join('\n')
  }

  prune(): void {
    const now = this.now()
    const days = this.durableDays()
    this.ephemeral = pruneLogRecords(this.ephemeral, now, days).filter(
      (row) => row.retention === 'ephemeral'
    )
    this.session = pruneLogRecords(this.session, now, days).filter((row) => row.retention === 'session')
    this.durable = pruneLogRecords(this.durable, now, days).filter((row) => row.retention === 'durable')
  }

  dispose(): void {
    this.persistWriter.flush()
  }

  private all(): AppLogRecord[] {
    return [...this.ephemeral, ...this.session, ...this.durable]
  }

  private bucket(cls: LogRetentionClass): AppLogRecord[] {
    if (cls === 'ephemeral') return this.ephemeral
    if (cls === 'session') return this.session
    return this.durable
  }

  private replaceClass(cls: LogRetentionClass, rows: AppLogRecord[]): void {
    if (cls === 'ephemeral') this.ephemeral = rows
    else if (cls === 'session') this.session = rows
    else this.durable = rows
  }

  private readFile(file: string): AppLogRecord[] {
    if (!existsSync(file)) return []
    try {
      const text = readFileSync(file, 'utf8')
      const rows: AppLogRecord[] = []
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = parseLogRecord(JSON.parse(trimmed) as unknown)
          if (parsed) rows.push(parsed)
        } catch {
          // skip corrupt line
        }
      }
      return rows
    } catch (err) {
      console.error('[logs] load failed', err)
      return []
    }
  }

  private writeFiles(): void {
    try {
      mkdirSync(this.dir, { recursive: true })
      this.writeClass(join(this.dir, SESSION_FILE), this.session)
      this.writeClass(join(this.dir, DURABLE_FILE), this.durable)
    } catch (err) {
      console.error('[logs] persist failed', err)
    }
  }

  private writeClass(file: string, rows: AppLogRecord[]): void {
    const body = rows.map((row) => JSON.stringify(row)).join('\n')
    const tmp = `${file}.tmp`
    writeFileSync(tmp, body ? `${body}\n` : '', 'utf8')
    renameSync(tmp, file)
  }
}
