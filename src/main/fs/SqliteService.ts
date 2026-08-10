/**
 * Read-only SQLite preview helpers (node:sqlite DatabaseSync).
 * Tables list + windowed SELECT for scroll virtualization — no arbitrary SQL
 * from the renderer, and no product pagination UI.
 *
 * Open handles and per-table (columns, COUNT) are cached so scroll-driven
 * chunk fetches don't re-open the DB or re-count every window.
 */

import { DatabaseSync } from 'node:sqlite'
import { basename } from 'node:path'
import { statSync } from 'node:fs'
import type { SqliteDatabaseInfo, SqliteQueryResult, SqliteTableInfo } from '@shared/ipc'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 500
/** Soft cap on cached open DBs (preview sessions). */
const DB_CACHE_MAX = 4

/** Safe SQL identifier: letters, digits, underscore only. */
function isSafeIdent(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

function quoteIdent(name: string): string {
  // Double-quote and escape any embedded quotes (defensive; isSafeIdent already tight).
  return `"${name.replace(/"/g, '""')}"`
}

function cellToString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value)
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return `<blob ${value.byteLength} B>`
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

interface TableMeta {
  columns: string[]
  total: number
}

interface CachedDb {
  db: DatabaseSync
  size: number
  mtimeMs: number
  lastAccess: number
  /** table name → columns + row count (once per open) */
  tables: Map<string, TableMeta>
}

const dbCache = new Map<string, CachedDb>()

function openReadonly(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true })
}

function fileStamp(path: string): { size: number; mtimeMs: number } | null {
  try {
    const st = statSync(path)
    return { size: st.size, mtimeMs: st.mtimeMs }
  } catch {
    return null
  }
}

function evictDbCache(): void {
  if (dbCache.size <= DB_CACHE_MAX) return
  const ordered = [...dbCache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)
  const drop = ordered.length - DB_CACHE_MAX
  for (let i = 0; i < drop; i++) {
    const [key, entry] = ordered[i]!
    try {
      entry.db.close()
    } catch {
      // ignore
    }
    dbCache.delete(key)
  }
}

/** Cached read-only handle; invalidates on size/mtime change. */
function getDb(path: string): CachedDb {
  const stamp = fileStamp(path)
  const existing = dbCache.get(path)
  if (
    existing &&
    stamp &&
    existing.size === stamp.size &&
    existing.mtimeMs === stamp.mtimeMs
  ) {
    existing.lastAccess = Date.now()
    return existing
  }
  if (existing) {
    try {
      existing.db.close()
    } catch {
      // ignore
    }
    dbCache.delete(path)
  }
  const db = openReadonly(path)
  const entry: CachedDb = {
    db,
    size: stamp?.size ?? 0,
    mtimeMs: stamp?.mtimeMs ?? 0,
    lastAccess: Date.now(),
    tables: new Map()
  }
  dbCache.set(path, entry)
  evictDbCache()
  return entry
}

function tableMeta(entry: CachedDb, table: string): TableMeta | { error: string } {
  const hit = entry.tables.get(table)
  if (hit) return hit

  const exists = entry.db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master
       WHERE type = 'table' AND name = ? LIMIT 1`
    )
    .get(table) as { ok?: number } | undefined
  if (!exists) return { error: 'Table not found' }

  let columns: string[] = []
  try {
    const info = entry.db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{
      name: string
    }>
    columns = info.map((c) => c.name)
  } catch {
    columns = []
  }

  let total = 0
  try {
    const cnt = entry.db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`).get() as {
      c: number
    }
    total = Number(cnt?.c ?? 0)
  } catch {
    total = 0
  }

  const meta: TableMeta = { columns, total }
  entry.tables.set(table, meta)
  return meta
}

export function isSqlitePath(path: string): boolean {
  const base = basename(path).toLowerCase()
  return (
    base.endsWith('.db') ||
    base.endsWith('.sqlite') ||
    base.endsWith('.sqlite3') ||
    base.endsWith('.db3')
  )
}

/** Inspect schema: tables + columns + approximate row counts. */
export function inspectSqlite(path: string): SqliteDatabaseInfo {
  const entry = getDb(path)
  const tableRows = entry.db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name COLLATE NOCASE`
    )
    .all() as Array<{ name: string }>

  const tables: SqliteTableInfo[] = []
  for (const { name } of tableRows) {
    if (!name || !isSafeIdent(name)) continue
    const meta = tableMeta(entry, name)
    if ('error' in meta) continue
    tables.push({ name, columns: meta.columns, rowCount: meta.total })
  }
  return { tables }
}

/** Windowed read of one table. Table name is validated — not free-form SQL. */
export function querySqliteTable(
  path: string,
  table: string,
  offset = 0,
  limit = DEFAULT_LIMIT
): SqliteQueryResult {
  const off = Math.max(0, Math.floor(offset) || 0)
  const lim = Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit) || DEFAULT_LIMIT))

  if (!isSafeIdent(table)) {
    return { columns: [], rows: [], total: 0, offset: off, limit: lim, error: 'Invalid table name' }
  }

  try {
    const entry = getDb(path)
    const meta = tableMeta(entry, table)
    if ('error' in meta) {
      return { columns: [], rows: [], total: 0, offset: off, limit: lim, error: meta.error }
    }

    // ORDER BY rowid for stable paging when available.
    let rowsRaw: Array<Record<string, unknown>>
    try {
      rowsRaw = entry.db
        .prepare(`SELECT * FROM ${quoteIdent(table)} ORDER BY rowid LIMIT ? OFFSET ?`)
        .all(lim, off) as Array<Record<string, unknown>>
    } catch {
      rowsRaw = entry.db
        .prepare(`SELECT * FROM ${quoteIdent(table)} LIMIT ? OFFSET ?`)
        .all(lim, off) as Array<Record<string, unknown>>
    }

    const rows = rowsRaw.map((row) =>
      meta.columns.map((col) => cellToString((row as Record<string, unknown>)[col]))
    )

    return {
      columns: meta.columns,
      rows,
      total: meta.total,
      offset: off,
      limit: lim
    }
  } catch (err) {
    return {
      columns: [],
      rows: [],
      total: 0,
      offset: off,
      limit: lim,
      error: (err as Error).message
    }
  }
}
