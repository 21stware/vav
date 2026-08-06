/**
 * Read-only analytical SQL over SQLite / CSV / TSV / Parquet files via DuckDB.
 *
 * One in-memory DuckDB instance per file, cached by (path, mtime, size) and
 * evicted LRU. SQLite files are ATTACHed with the sqlite_scanner extension and
 * each table surfaced as a top-level view (so the agent can write
 * `SELECT * FROM items` instead of `src.items`). CSV/TSV/Parquet are registered
 * as views over `read_csv_auto` / `read_parquet`. All queries run against the
 * transient in-memory DB — source files are never written to.
 */

import { basename, extname } from 'node:path'
import { stat } from 'node:fs/promises'

/** Loaded on first real query — keep the native addon off the cold-start path. */
type DuckDBConnection = import('@duckdb/node-api').DuckDBConnection
type DuckDBInstance = import('@duckdb/node-api').DuckDBInstance

const MAX_ROWS = 500
const MAX_CELLL_STRING = 2000
const LRU_MAX = 8
/** SQLite files can be large; cap indexed size to keep ATTACH snappy. */
const MAX_FILE_BYTES = 256 * 1024 * 1024

export type DuckDbKind = 'sqlite' | 'csv' | 'parquet'

export function duckDbKindForPath(path: string): DuckDbKind | null {
  const ext = extname(path).toLowerCase()
  if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3' || ext === '.db3') return 'sqlite'
  if (ext === '.csv' || ext === '.tsv') return 'csv'
  if (ext === '.parquet') return 'parquet'
  return null
}

export interface DuckDbTableInfo {
  name: string
  columns: string[]
  rowCount: number
}

export interface DuckDbSchema {
  kind: DuckDbKind
  tables: DuckDbTableInfo[]
}

export interface DuckDbQueryResult {
  columns: string[]
  rows: string[][]
  rowCount: number
  truncated: boolean
  error?: string
}

interface CachedInstance {
  conn: DuckDBConnection
  kind: DuckDbKind
  tables: string[]
  size: number
  mtimeMs: number
  lastAccess: number
}

function sanitizeIdent(name: string): string {
  // DuckDB identifier: letters, digits, underscore. Strip anything else.
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `t_${cleaned}`
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** Stringify a DuckDB cell for the agent/UI. Complex types become JSON. */
function cellToString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    try {
      const json = JSON.stringify(value, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v
      )
      return json.length > MAX_CELLL_STRING ? `${json.slice(0, MAX_CELLL_STRING)}…` : json
    } catch {
      return String(value)
    }
  }
  return String(value)
}

export class DuckDbService {
  private cache = new Map<string, CachedInstance>()
  private inflight = new Map<string, Promise<CachedInstance>>()

  async schema(path: string): Promise<DuckDbSchema | { error: string }> {
    let conn: DuckDBConnection
    let kind: DuckDbKind
    let tables: string[]
    try {
      const entry = await this.load(path)
      conn = entry.conn
      kind = entry.kind
      tables = entry.tables
    } catch (err) {
      return { error: (err as Error).message }
    }

    const out: DuckDbTableInfo[] = []
    for (const table of tables) {
      try {
        const colsRes = await conn.run(`DESCRIBE ${quoteIdent(table)}`)
        const colsRows = await colsRes.getRows()
        const columns = colsRows.map((r) => String(r[0] ?? ''))
        const cntRes = await conn.run(`SELECT count(*) AS c FROM ${quoteIdent(table)}`)
        const cntRows = await cntRes.getRows()
        const rowCount = Number(cntRows[0]?.[0] ?? 0)
        out.push({ name: table, columns, rowCount })
      } catch {
        out.push({ name: table, columns: [], rowCount: 0 })
      }
    }
    return { kind, tables: out }
  }

  async query(path: string, sql: string): Promise<DuckDbQueryResult> {
    const trimmed = sql.trim()
    if (!trimmed) return { columns: [], rows: [], rowCount: 0, truncated: false, error: 'Empty SQL' }

    let conn: DuckDBConnection
    try {
      const entry = await this.load(path)
      conn = entry.conn
    } catch (err) {
      return { columns: [], rows: [], rowCount: 0, truncated: false, error: (err as Error).message }
    }

    let result
    try {
      result = await conn.run(trimmed)
    } catch (err) {
      return { columns: [], rows: [], rowCount: 0, truncated: false, error: (err as Error).message }
    }

    let columns: string[] = []
    let rawRows: unknown[][] = []
    try {
      columns = result.columnNames() as string[]
      rawRows = await result.getRows()
    } catch (err) {
      return { columns: [], rows: [], rowCount: 0, truncated: false, error: (err as Error).message }
    }

    const truncated = rawRows.length > MAX_ROWS
    const sliced = truncated ? rawRows.slice(0, MAX_ROWS) : rawRows
    const rows = sliced.map((row) => row.map(cellToString))
    return { columns, rows, rowCount: rawRows.length, truncated }
  }

  clearCache(): void {
    this.cache.clear()
    this.inflight.clear()
  }

  // ---------------------------------------------------------------------------

  private async load(path: string): Promise<CachedInstance> {
    const info = await stat(path)
    if (info.size <= 0) throw new Error('File is empty')
    if (info.size > MAX_FILE_BYTES) {
      throw new Error(
        `File too large for DuckDB (${Math.round(info.size / 1024 / 1024)} MB; max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)`
      )
    }

    const existing = this.cache.get(path)
    if (existing && existing.size === info.size && existing.mtimeMs === info.mtimeMs) {
      existing.lastAccess = Date.now()
      return existing
    }

    const pending = this.inflight.get(path)
    if (pending) return pending

    const job = this.build(path, info.size, info.mtimeMs).finally(() => {
      this.inflight.delete(path)
    })
    this.inflight.set(path, job)
    return job
  }

  private async build(path: string, size: number, mtimeMs: number): Promise<CachedInstance> {
    const kind = duckDbKindForPath(path)
    if (!kind) throw new Error(`Unsupported file type for DuckDB: ${extname(path) || path}`)

    const { DuckDBInstance } = await import('@duckdb/node-api')
    const inst: DuckDBInstance = await DuckDBInstance.create(':memory:')
    const conn = await inst.connect()
    const stem = sanitizeIdent(basename(path, extname(path)))
    const tables: string[] = []

    if (kind === 'sqlite') {
      await conn.run(`ATTACH ${literal(path)} AS src (TYPE sqlite)`)
      const listRes = await conn.run('SHOW TABLES FROM src')
      const listRows = await listRes.getRows()
      for (const [name] of listRows) {
        const tbl = String(name)
        const viewName = sanitizeIdent(tbl)
        await conn.run(`CREATE VIEW ${quoteIdent(viewName)} AS SELECT * FROM src.${quoteIdent(tbl)}`)
        tables.push(viewName)
      }
    } else if (kind === 'csv') {
      const opts = path.toLowerCase().endsWith('.tsv') ? `, delim='\\t'` : ''
      await conn.run(
        `CREATE VIEW ${quoteIdent(stem)} AS SELECT * FROM read_csv_auto(${literal(path)}${opts})`
      )
      tables.push(stem)
    } else {
      await conn.run(
        `CREATE VIEW ${quoteIdent(stem)} AS SELECT * FROM read_parquet(${literal(path)})`
      )
      tables.push(stem)
    }

    const entry: CachedInstance = {
      conn,
      kind,
      tables,
      size,
      mtimeMs,
      lastAccess: Date.now()
    }
    this.cache.set(path, entry)
    this.evictLru()
    return entry
  }

  private evictLru(): void {
    if (this.cache.size <= LRU_MAX) return
    const ordered = [...this.cache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)
    const drop = ordered.length - LRU_MAX
    for (let i = 0; i < drop; i++) {
      const [key] = ordered[i]!
      this.cache.delete(key)
    }
  }
}

function literal(value: string): string {
  // Single-quoted string literal with escaped quotes.
  return `'${value.replace(/'/g, "''")}'`
}
