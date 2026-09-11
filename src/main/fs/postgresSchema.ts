/**
 * PostgreSQL catalog inspect — table list + columns without COUNT(*).
 * Per-table counts on large / restricted objects time out or 42501 and used
 * to fail the whole schema read.
 */

import type { SqliteDatabaseInfo, SqliteTableInfo } from '../../shared/ipc.ts'

/** Table names only — columns load with the first page so catalog inspect cannot stall. */
export const PG_SCHEMA_TABLES_SQL = `SELECT n.nspname AS nsp, c.relname AS name,
        GREATEST(c.reltuples, 0)::bigint AS estimate
 FROM pg_class c
 JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p', 'v', 'm')
   AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
   AND n.nspname NOT LIKE 'pg_temp_%'
   AND n.nspname NOT LIKE 'pg_toast_temp_%'
 ORDER BY n.nspname, c.relname`

export const PG_SCHEMA_COLUMNS_SQL = `SELECT n.nspname AS nsp, c.relname AS name, a.attname AS col
 FROM pg_attribute a
 JOIN pg_class c ON c.oid = a.attrelid
 JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE a.attnum > 0
   AND NOT a.attisdropped
   AND c.relkind IN ('r', 'p', 'v', 'm')
   AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
   AND n.nspname NOT LIKE 'pg_temp_%'
   AND n.nspname NOT LIKE 'pg_toast_temp_%'
 ORDER BY n.nspname, c.relname, a.attnum`

export const PG_STATEMENT_TIMEOUT_MS = 8_000
export const PG_CONNECT_TIMEOUT_MS = 8_000

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const PG_TABLE_ESTIMATE_SQL = `SELECT GREATEST(c.reltuples, 0)::bigint AS estimate
 FROM pg_class c
 JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = $1 AND c.relname = $2
 LIMIT 1`

export function qualifyPgTableName(schema: string, name: string): string {
  return schema === 'public' ? name : `${schema}.${name}`
}

export function splitPgTableName(qualified: string): { schema: string; name: string } {
  const dot = qualified.indexOf('.')
  if (dot > 0 && dot < qualified.length - 1) {
    return { schema: qualified.slice(0, dot), name: qualified.slice(dot + 1) }
  }
  return { schema: 'public', name: qualified }
}

export function assemblePostgresSchema(
  tables: Array<{ schema: string; name: string; estimate: number }>,
  columns: Array<{ schema: string; name: string; col: string }> = []
): SqliteDatabaseInfo {
  const cols = new Map<string, string[]>()
  for (const column of columns) {
    const key = qualifyPgTableName(column.schema, column.name)
    const list = cols.get(key)
    if (list) list.push(column.col)
    else cols.set(key, [column.col])
  }
  const assembled: SqliteTableInfo[] = tables.map((item) => {
    const qualified = qualifyPgTableName(item.schema, item.name)
    return {
      name: qualified,
      columns: cols.get(qualified) ?? [],
      rowCount: Number.isFinite(item.estimate) ? Math.max(0, Math.floor(item.estimate)) : 0
    }
  })
  return { tables: assembled }
}

/** Exact end when a page is short; otherwise prefer catalog estimate and keep paging. */
export function resolvePgTableTotal(opts: {
  offset: number
  limit: number
  rowCount: number
  estimate: number
}): number {
  const { offset, limit, rowCount, estimate } = opts
  if (rowCount < limit) return offset + rowCount
  return Math.max(estimate, offset + rowCount + 1)
}
