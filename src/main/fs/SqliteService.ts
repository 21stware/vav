/**
 * Read-only SQLite preview helpers (node:sqlite DatabaseSync).
 * Tables list + windowed SELECT for scroll virtualization — no arbitrary SQL
 * from the renderer, and no product pagination UI.
 */

import { DatabaseSync } from 'node:sqlite'
import { basename } from 'node:path'
import type { SqliteDatabaseInfo, SqliteQueryResult, SqliteTableInfo } from '@shared/ipc'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 500

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

function openReadonly(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true })
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
  const db = openReadonly(path)
  try {
    const tableRows = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name COLLATE NOCASE`
      )
      .all() as Array<{ name: string }>

    const tables: SqliteTableInfo[] = []
    for (const { name } of tableRows) {
      if (!name || !isSafeIdent(name)) continue
      let columns: string[] = []
      try {
        const info = db.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all() as Array<{
          name: string
        }>
        columns = info.map((c) => c.name)
      } catch {
        columns = []
      }
      let rowCount = 0
      try {
        const cnt = db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(name)}`).get() as {
          c: number
        }
        rowCount = Number(cnt?.c ?? 0)
      } catch {
        rowCount = 0
      }
      tables.push({ name, columns, rowCount })
    }
    return { tables }
  } finally {
    db.close()
  }
}

/** Page through one table. Table name is validated — not free-form SQL. */
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

  const db = openReadonly(path)
  try {
    // Confirm table exists.
    const exists = db
      .prepare(
        `SELECT 1 AS ok FROM sqlite_master
         WHERE type = 'table' AND name = ? LIMIT 1`
      )
      .get(table) as { ok?: number } | undefined
    if (!exists) {
      return { columns: [], rows: [], total: 0, offset: off, limit: lim, error: 'Table not found' }
    }

    const info = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{
      name: string
    }>
    const columns = info.map((c) => c.name)
    const cnt = db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`).get() as { c: number }
    const total = Number(cnt?.c ?? 0)

    // ORDER BY rowid for stable paging when available.
    let rowsRaw: Array<Record<string, unknown>>
    try {
      rowsRaw = db
        .prepare(
          `SELECT * FROM ${quoteIdent(table)} ORDER BY rowid LIMIT ? OFFSET ?`
        )
        .all(lim, off) as Array<Record<string, unknown>>
    } catch {
      rowsRaw = db
        .prepare(`SELECT * FROM ${quoteIdent(table)} LIMIT ? OFFSET ?`)
        .all(lim, off) as Array<Record<string, unknown>>
    }

    const rows = rowsRaw.map((row) =>
      columns.map((col) => cellToString((row as Record<string, unknown>)[col]))
    )

    return { columns, rows, total, offset: off, limit: lim }
  } catch (err) {
    return {
      columns: [],
      rows: [],
      total: 0,
      offset: off,
      limit: lim,
      error: (err as Error).message
    }
  } finally {
    db.close()
  }
}
