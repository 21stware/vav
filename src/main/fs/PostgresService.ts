/**
 * Live PostgreSQL: schema inspect + windowed table reads + read-only SQL.
 * Connection configs come from {@link DbConnectionStore}; passwords stay in
 * the secret vault. Source tables are never written.
 */

import type { SqliteDatabaseInfo, SqliteQueryResult, SqliteTableInfo } from '../../shared/ipc.ts'
import {
  isReadOnlySql,
  isSingleSqlStatement,
  type DbConnection
} from '../../shared/dbConnection.ts'
import type { DbConnectionStore } from '../store/DbConnectionStore.ts'

const MAX_ROWS = 500
const MAX_CELL = 2000
const POOL_MAX = 4

type PgPool = import('pg').Pool
type PgClient = import('pg').PoolClient

export interface PostgresQueryResult {
  columns: string[]
  rows: string[][]
  rowCount: number
  truncated: boolean
  error?: string
}

interface CachedPool {
  pool: PgPool
  fingerprint: string
  lastAccess: number
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function tableSqlName(name: string): string {
  const dot = name.indexOf('.')
  if (dot > 0 && dot < name.length - 1) {
    return `${quoteIdent(name.slice(0, dot))}.${quoteIdent(name.slice(dot + 1))}`
  }
  return quoteIdent(name)
}

function cellToString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') {
    return value.length > MAX_CELL ? `${value.slice(0, MAX_CELL)}…` : value
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value)
  }
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return `<blob ${value.byteLength} B>`
  }
  try {
    const json = JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    return json.length > MAX_CELL ? `${json.slice(0, MAX_CELL)}…` : json
  } catch {
    return String(value)
  }
}

function fingerprintOf(row: DbConnection, password: string | null): string {
  return [
    row.driver,
    row.host,
    String(row.port),
    row.database,
    row.user,
    row.ssl ? '1' : '0',
    password ?? ''
  ].join('\0')
}

export class PostgresService {
  private cache = new Map<string, CachedPool>()

  constructor(private readonly store: DbConnectionStore) {}

  async test(id: string): Promise<{ ok: boolean; error?: string }> {
    const row = this.store.get(id)
    if (!row) return { ok: false, error: 'Connection not found' }
    if (row.driver !== 'postgres') {
      return { ok: false, error: `${row.driver} is not implemented yet` }
    }
    try {
      const client = await this.client(row)
      try {
        await client.query('SELECT 1')
      } finally {
        client.release()
      }
      this.store.markStatus(id, 'ok', null)
      return { ok: true }
    } catch (err) {
      const message = (err as Error).message
      this.store.markStatus(id, 'failed', message)
      return { ok: false, error: message }
    }
  }

  async schema(id: string): Promise<SqliteDatabaseInfo | { error: string }> {
    const row = this.store.get(id)
    if (!row) return { error: 'Connection not found' }
    if (row.driver !== 'postgres') return { error: `${row.driver} is not implemented yet` }
    let client: PgClient
    try {
      client = await this.client(row)
    } catch (err) {
      return { error: (err as Error).message }
    }
    try {
      const listed = await client.query<{ schema: string; name: string }>(
        `SELECT n.nspname AS schema, c.relname AS name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r', 'p', 'v', 'm')
           AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         ORDER BY n.nspname, c.relname`
      )
      const tables: SqliteTableInfo[] = []
      for (const item of listed.rows) {
        const qualified = item.schema === 'public' ? item.name : `${item.schema}.${item.name}`
        const cols = await client.query<{ column_name: string }>(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          [item.schema, item.name]
        )
        const count = await client.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM ${tableSqlName(qualified)}`
        )
        tables.push({
          name: qualified,
          columns: cols.rows.map((col) => col.column_name),
          rowCount: Number(count.rows[0]?.c ?? 0)
        })
      }
      this.store.markStatus(id, 'ok', null)
      return { tables }
    } catch (err) {
      const message = (err as Error).message
      this.store.markStatus(id, 'failed', message)
      return { error: message }
    } finally {
      client.release()
    }
  }

  async queryTable(
    id: string,
    table: string,
    offset: number,
    limit: number
  ): Promise<SqliteQueryResult> {
    const safeOffset = Math.max(0, Math.floor(offset))
    const safeLimit = Math.min(MAX_ROWS, Math.max(1, Math.floor(limit) || MAX_ROWS))
    const row = this.store.get(id)
    if (!row) {
      return { columns: [], rows: [], total: 0, offset: safeOffset, limit: safeLimit, error: 'Connection not found' }
    }
    try {
      const client = await this.client(row)
      try {
        const result = await client.query(
          `SELECT * FROM ${tableSqlName(table)} OFFSET $1 LIMIT $2`,
          [safeOffset, safeLimit]
        )
        const count = await client.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM ${tableSqlName(table)}`
        )
        const columns = result.fields.map((field) => field.name)
        const rows = result.rows.map((record) => columns.map((col) => cellToString(record[col])))
        return {
          columns,
          rows,
          total: Number(count.rows[0]?.c ?? 0),
          offset: safeOffset,
          limit: safeLimit
        }
      } finally {
        client.release()
      }
    } catch (err) {
      return {
        columns: [],
        rows: [],
        total: 0,
        offset: safeOffset,
        limit: safeLimit,
        error: (err as Error).message
      }
    }
  }

  async querySql(id: string, sql: string): Promise<PostgresQueryResult> {
    const statement = sql.trim()
    if (!statement) return { columns: [], rows: [], rowCount: 0, truncated: false, error: 'Missing sql' }
    if (!isSingleSqlStatement(statement)) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        error: 'One statement only'
      }
    }
    if (!isReadOnlySql(statement)) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        error: 'Only read-only SQL is allowed (SELECT / WITH / EXPLAIN / SHOW)'
      }
    }
    const row = this.store.get(id)
    if (!row) return { columns: [], rows: [], rowCount: 0, truncated: false, error: 'Connection not found' }
    try {
      const client = await this.client(row)
      try {
        const result = await client.query(statement)
        const columns = result.fields?.map((field) => field.name) ?? []
        const all = (result.rows ?? []).map((record) =>
          columns.map((col) => cellToString((record as Record<string, unknown>)[col]))
        )
        const truncated = all.length > MAX_ROWS
        const rows = truncated ? all.slice(0, MAX_ROWS) : all
        return { columns, rows, rowCount: all.length, truncated }
      } finally {
        client.release()
      }
    } catch (err) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        error: (err as Error).message
      }
    }
  }

  evict(id: string): void {
    const entry = this.cache.get(id)
    if (!entry) return
    this.cache.delete(id)
    void entry.pool.end().catch(() => undefined)
  }

  async close(): Promise<void> {
    const pools = [...this.cache.values()]
    this.cache.clear()
    await Promise.all(pools.map((entry) => entry.pool.end().catch(() => undefined)))
  }

  private async client(row: DbConnection): Promise<PgClient> {
    const password = this.store.password(row.id)
    const fingerprint = fingerprintOf(row, password)
    let entry = this.cache.get(row.id)
    if (!entry || entry.fingerprint !== fingerprint) {
      if (entry) void entry.pool.end().catch(() => undefined)
      const { Pool } = await import('pg')
      entry = {
        pool: new Pool({
          host: row.host || 'localhost',
          port: row.port,
          database: row.database || undefined,
          user: row.user || undefined,
          password: password || undefined,
          ssl: row.ssl ? { rejectUnauthorized: false } : undefined,
          max: 2,
          connectionTimeoutMillis: 8000,
          idleTimeoutMillis: 30_000
        }),
        fingerprint,
        lastAccess: Date.now()
      }
      this.cache.set(row.id, entry)
      this.evictLru()
    }
    entry.lastAccess = Date.now()
    return entry.pool.connect()
  }

  private evictLru(): void {
    if (this.cache.size <= POOL_MAX) return
    const ordered = [...this.cache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)
    const drop = ordered.length - POOL_MAX
    for (let i = 0; i < drop; i++) {
      const [id, entry] = ordered[i]!
      this.cache.delete(id)
      void entry.pool.end().catch(() => undefined)
    }
  }
}
