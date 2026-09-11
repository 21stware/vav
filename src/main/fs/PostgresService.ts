/**
 * Live databases: schema inspect + windowed table reads + read-only SQL.
 * Connection configs come from {@link DbConnectionStore}; secrets stay in
 * the vault. Source tables are never written.
 */

import { existsSync } from 'node:fs'
import type { SqliteDatabaseInfo, SqliteQueryResult, SqliteTableInfo } from '../../shared/ipc.ts'
import {
  dbUrlWithPassword,
  isDbDriverImplemented,
  isReadOnlySql,
  isSingleSqlStatement,
  parseDbUrl,
  type DbConnection,
  type DbDriver
} from '../../shared/dbConnection.ts'
import type { DbConnectionStore } from '../store/DbConnectionStore.ts'
import {
  assemblePostgresSchema,
  PG_CONNECT_TIMEOUT_MS,
  PG_SCHEMA_TABLES_SQL,
  PG_STATEMENT_TIMEOUT_MS,
  PG_TABLE_ESTIMATE_SQL,
  resolvePgTableTotal,
  splitPgTableName,
  withTimeout
} from './postgresSchema.ts'

const MAX_ROWS = 500
const MAX_CELL = 2000
const POOL_MAX = 4

type PgPool = import('pg').Pool
type PgClient = import('pg').PoolClient
type MysqlPool = import('mysql2/promise').Pool
type MysqlConn = import('mysql2/promise').PoolConnection
type ClickHouseClient = import('@clickhouse/client').ClickHouseClient
type BigQueryClient = import('@google-cloud/bigquery').BigQuery
type DuckDBConnection = import('@duckdb/node-api').DuckDBConnection
type DuckDBInstance = import('@duckdb/node-api').DuckDBInstance

export interface PostgresQueryResult {
  columns: string[]
  rows: string[][]
  rowCount: number
  truncated: boolean
  error?: string
}

type CachedHandle =
  | { kind: 'postgres'; pool: PgPool; fingerprint: string; lastAccess: number }
  | { kind: 'mysql'; pool: MysqlPool; fingerprint: string; lastAccess: number }
  | { kind: 'clickhouse'; client: ClickHouseClient; fingerprint: string; lastAccess: number }
  | { kind: 'bigquery'; client: BigQueryClient; fingerprint: string; lastAccess: number }
  | { kind: 'duckdb'; inst: DuckDBInstance; conn: DuckDBConnection; fingerprint: string; lastAccess: number }

function quoteIdent(driver: DbDriver, name: string): string {
  if (driver === 'mysql' || driver === 'clickhouse' || driver === 'bigquery') {
    return `\`${name.replace(/`/g, '``')}\``
  }
  return `"${name.replace(/"/g, '""')}"`
}

function tableSqlName(driver: DbDriver, name: string): string {
  return name
    .split('.')
    .filter(Boolean)
    .map((part) => quoteIdent(driver, part))
    .join('.')
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
    row.useUrl ? 'url' : 'fields',
    row.useUrl ? row.url : [row.host, String(row.port), row.database, row.user].join('\0'),
    row.ssl ? '1' : '0',
    password ?? ''
  ].join('\0')
}

function duckdbPathOf(row: DbConnection): string {
  if (row.useUrl) {
    const parsed = parseDbUrl(row.url, 'duckdb')
    const path = (parsed?.database || row.url).trim()
    if (!path) throw new Error('DuckDB file path is required')
    return path
  }
  const path = row.database.trim()
  if (!path) throw new Error('DuckDB file path is required')
  return path
}

function bigqueryProjectOf(row: DbConnection): string {
  if (row.useUrl) {
    const parsed = parseDbUrl(row.url, 'bigquery')
    return (parsed?.database || row.database).trim()
  }
  return row.database.trim()
}

function bigqueryLocationOf(row: DbConnection): string | undefined {
  if (row.useUrl) {
    const parsed = parseDbUrl(row.url, 'bigquery')
    return (parsed?.host || row.host).trim() || undefined
  }
  return row.host.trim() || undefined
}

function bigqueryDatasetOf(row: DbConnection): string | undefined {
  if (row.useUrl) {
    const parsed = parseDbUrl(row.url, 'bigquery')
    return (parsed?.user || row.user).trim() || undefined
  }
  return row.user.trim() || undefined
}

function emptyQuery(error: string, offset = 0, limit = MAX_ROWS): SqliteQueryResult {
  return { columns: [], rows: [], total: 0, offset, limit, error }
}

function emptySql(error: string): PostgresQueryResult {
  return { columns: [], rows: [], rowCount: 0, truncated: false, error }
}

function guardSql(sql: string): PostgresQueryResult | null {
  const statement = sql.trim()
  if (!statement) return emptySql('Missing sql')
  if (!isSingleSqlStatement(statement)) return emptySql('One statement only')
  if (!isReadOnlySql(statement)) {
    return emptySql('Only read-only SQL is allowed (SELECT / WITH / EXPLAIN / SHOW)')
  }
  return null
}

export class PostgresService {
  private cache = new Map<string, CachedHandle>()

  constructor(private readonly store: DbConnectionStore) {}

  connection(id: string): DbConnection | undefined {
    return this.store.get(id)
  }

  async test(id: string): Promise<{ ok: boolean; error?: string }> {
    const row = this.store.get(id)
    if (!row) return { ok: false, error: 'Connection not found' }
    if (!isDbDriverImplemented(row.driver)) {
      return { ok: false, error: `${row.driver} is not implemented yet` }
    }
    try {
      await withTimeout(
        this.ping(row),
        PG_CONNECT_TIMEOUT_MS + PG_STATEMENT_TIMEOUT_MS,
        'Connect'
      )
      this.store.markStatus(id, 'ok', null)
      return { ok: true }
    } catch (err) {
      this.evict(id)
      const message = (err as Error).message
      this.store.markStatus(id, 'failed', message)
      return { ok: false, error: message }
    }
  }

  async schema(id: string): Promise<SqliteDatabaseInfo | { error: string }> {
    const row = this.store.get(id)
    if (!row) return { error: 'Connection not found' }
    if (!isDbDriverImplemented(row.driver)) return { error: `${row.driver} is not implemented yet` }
    try {
      const tables = await withTimeout(
        this.listTables(row),
        PG_STATEMENT_TIMEOUT_MS + PG_CONNECT_TIMEOUT_MS,
        'Schema'
      )
      return { tables }
    } catch (err) {
      this.evict(id)
      return { error: (err as Error).message }
    }
  }

  async queryTable(
    id: string,
    table: string,
    offset: number,
    limit: number
  ): Promise<SqliteQueryResult> {
    const safeOffset = Math.max(0, Math.floor(offset))
    const parsedLimit = Math.floor(limit)
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(MAX_ROWS, Math.max(0, parsedLimit))
      : MAX_ROWS
    const row = this.store.get(id)
    if (!row) return emptyQuery('Connection not found', safeOffset, safeLimit)
    if (!isDbDriverImplemented(row.driver)) {
      return emptyQuery(`${row.driver} is not implemented yet`, safeOffset, safeLimit)
    }
    try {
      return await withTimeout(
        this.selectTable(row, table, safeOffset, safeLimit),
        PG_STATEMENT_TIMEOUT_MS + PG_CONNECT_TIMEOUT_MS,
        'Table'
      )
    } catch (err) {
      this.evict(id)
      return emptyQuery((err as Error).message, safeOffset, safeLimit)
    }
  }

  async querySql(id: string, sql: string): Promise<PostgresQueryResult> {
    const blocked = guardSql(sql)
    if (blocked) return blocked
    const row = this.store.get(id)
    if (!row) return emptySql('Connection not found')
    if (!isDbDriverImplemented(row.driver)) return emptySql(`${row.driver} is not implemented yet`)
    try {
      return await withTimeout(
        this.runSql(row, sql.trim()),
        PG_STATEMENT_TIMEOUT_MS + PG_CONNECT_TIMEOUT_MS,
        'SQL'
      )
    } catch (err) {
      this.evict(id)
      return emptySql((err as Error).message)
    }
  }

  evict(id: string): void {
    const entry = this.cache.get(id)
    if (!entry) return
    this.cache.delete(id)
    void this.dispose(entry)
  }

  async close(): Promise<void> {
    const handles = [...this.cache.values()]
    this.cache.clear()
    await Promise.all(handles.map((entry) => this.dispose(entry)))
  }

  private async ping(row: DbConnection): Promise<void> {
    if (row.driver === 'postgres') {
      await this.withPgClient(row, (client) => client.query('SELECT 1'))
      return
    }
    if (row.driver === 'mysql') {
      const conn = await this.mysqlConn(row)
      try {
        await conn.query('SELECT 1')
      } finally {
        conn.release()
      }
      return
    }
    if (row.driver === 'clickhouse') {
      const client = await this.clickhouse(row)
      const ping = await client.ping()
      if (!ping.success) {
        throw new Error(ping.error?.message || 'ClickHouse ping failed')
      }
      return
    }
    if (row.driver === 'bigquery') {
      const client = await this.bigquery(row)
      await client.query({ query: 'SELECT 1', location: bigqueryLocationOf(row) })
      return
    }
    const conn = await this.duckdb(row)
    await conn.run('SELECT 1')
  }

  private async listTables(row: DbConnection): Promise<SqliteTableInfo[]> {
    if (row.driver === 'postgres') return this.postgresSchema(row)
    if (row.driver === 'mysql') return this.mysqlSchema(row)
    if (row.driver === 'clickhouse') return this.clickhouseSchema(row)
    if (row.driver === 'bigquery') return this.bigquerySchema(row)
    return this.duckdbSchema(row)
  }

  private async selectTable(
    row: DbConnection,
    table: string,
    offset: number,
    limit: number
  ): Promise<SqliteQueryResult> {
    const ident = tableSqlName(row.driver, table)
    if (row.driver === 'postgres') {
      return this.withPgClient(row, async (client) => {
        const { schema, name } = splitPgTableName(table)
        if (limit === 0) {
          const result = await client.query(`SELECT * FROM ${ident} LIMIT 0`)
          const estimate = await client.query<{ estimate: string }>(PG_TABLE_ESTIMATE_SQL, [
            schema,
            name
          ])
          return {
            columns: result.fields.map((field) => field.name),
            rows: [],
            total: Number(estimate.rows[0]?.estimate ?? 0),
            offset,
            limit
          }
        }
        const result = await client.query(`SELECT * FROM ${ident} OFFSET $1 LIMIT $2`, [
          offset,
          limit
        ])
        const estimate = await client.query<{ estimate: string }>(PG_TABLE_ESTIMATE_SQL, [
          schema,
          name
        ])
        const columns = result.fields.map((field) => field.name)
        const rows = result.rows.map((record) => columns.map((col) => cellToString(record[col])))
        return {
          columns,
          rows,
          total: resolvePgTableTotal({
            offset,
            limit,
            rowCount: rows.length,
            estimate: Number(estimate.rows[0]?.estimate ?? 0)
          }),
          offset,
          limit
        }
      })
    }
    if (row.driver === 'mysql') {
      const conn = await this.mysqlConn(row)
      try {
        const [records, fields] = await conn.query(`SELECT * FROM ${ident} LIMIT ? OFFSET ?`, [
          limit,
          offset
        ])
        const [countRows] = await conn.query(`SELECT COUNT(*) AS c FROM ${ident}`)
        const columns = (Array.isArray(fields) ? fields : []).map((field) => field.name)
        const list = Array.isArray(records) ? (records as Record<string, unknown>[]) : []
        const rows = list.map((record) => columns.map((col) => cellToString(record[col])))
        const totalRow = Array.isArray(countRows) ? (countRows[0] as { c?: unknown }) : undefined
        return { columns, rows, total: Number(totalRow?.c ?? 0), offset, limit }
      } finally {
        conn.release()
      }
    }
    if (row.driver === 'clickhouse') {
      const client = await this.clickhouse(row)
      const result = await this.clickhouseRows(
        client,
        `SELECT * FROM ${ident} LIMIT ${limit} OFFSET ${offset}`
      )
      const count = await this.clickhouseRows(client, `SELECT count() AS c FROM ${ident}`)
      return {
        columns: result.columns,
        rows: result.rows,
        total: Number(count.rows[0]?.[0] ?? 0),
        offset,
        limit
      }
    }
    if (row.driver === 'bigquery') {
      const client = await this.bigquery(row)
      const location = bigqueryLocationOf(row)
      const [job] = await client.createQueryJob({
        query: `SELECT * FROM ${ident} LIMIT ${limit} OFFSET ${offset}`,
        location
      })
      const [records] = await job.getQueryResults()
      const columns = this.bigqueryColumns(job)
      const rows = (records ?? []).map((record) =>
        columns.map((col) => cellToString((record as Record<string, unknown>)[col]))
      )
      const [countJob] = await client.createQueryJob({
        query: `SELECT COUNT(*) AS c FROM ${ident}`,
        location
      })
      const [countRows] = await countJob.getQueryResults()
      return {
        columns,
        rows,
        total: Number((countRows?.[0] as { c?: unknown } | undefined)?.c ?? 0),
        offset,
        limit
      }
    }
    const conn = await this.duckdb(row)
    const page = await conn.run(`SELECT * FROM ${ident} LIMIT ${limit} OFFSET ${offset}`)
    const countRes = await conn.run(`SELECT count(*) AS c FROM ${ident}`)
    const columns = page.columnNames() as string[]
    const rawRows = await page.getRows()
    const countRows = await countRes.getRows()
    return {
      columns,
      rows: rawRows.map((record) => record.map(cellToString)),
      total: Number(countRows[0]?.[0] ?? 0),
      offset,
      limit
    }
  }

  private async runSql(row: DbConnection, sql: string): Promise<PostgresQueryResult> {
    if (row.driver === 'postgres') {
      return this.withPgClient(row, async (client) => {
        const result = await client.query(sql)
        const columns = result.fields?.map((field) => field.name) ?? []
        const all = (result.rows ?? []).map((record) =>
          columns.map((col) => cellToString((record as Record<string, unknown>)[col]))
        )
        const truncated = all.length > MAX_ROWS
        return {
          columns,
          rows: truncated ? all.slice(0, MAX_ROWS) : all,
          rowCount: all.length,
          truncated
        }
      })
    }
    if (row.driver === 'mysql') {
      const conn = await this.mysqlConn(row)
      try {
        const [records, fields] = await conn.query(sql)
        const columns = (Array.isArray(fields) ? fields : []).map((field) => field.name)
        const list = Array.isArray(records) ? (records as Record<string, unknown>[]) : []
        const all = list.map((record) => columns.map((col) => cellToString(record[col])))
        const truncated = all.length > MAX_ROWS
        return {
          columns,
          rows: truncated ? all.slice(0, MAX_ROWS) : all,
          rowCount: all.length,
          truncated
        }
      } finally {
        conn.release()
      }
    }
    if (row.driver === 'clickhouse') {
      const client = await this.clickhouse(row)
      const result = await this.clickhouseRows(client, sql)
      const truncated = result.rows.length > MAX_ROWS
      return {
        columns: result.columns,
        rows: truncated ? result.rows.slice(0, MAX_ROWS) : result.rows,
        rowCount: result.rows.length,
        truncated
      }
    }
    if (row.driver === 'bigquery') {
      const client = await this.bigquery(row)
      const [job] = await client.createQueryJob({
        query: sql,
        location: bigqueryLocationOf(row)
      })
      const [records] = await job.getQueryResults()
      const columns = this.bigqueryColumns(job)
      const all = (records ?? []).map((record) =>
        columns.map((col) => cellToString((record as Record<string, unknown>)[col]))
      )
      const truncated = all.length > MAX_ROWS
      return {
        columns,
        rows: truncated ? all.slice(0, MAX_ROWS) : all,
        rowCount: all.length,
        truncated
      }
    }
    const conn = await this.duckdb(row)
    const result = await conn.run(sql)
    const columns = result.columnNames() as string[]
    const rawRows = await result.getRows()
    const truncated = rawRows.length > MAX_ROWS
    const sliced = truncated ? rawRows.slice(0, MAX_ROWS) : rawRows
    return {
      columns,
      rows: sliced.map((record) => record.map(cellToString)),
      rowCount: rawRows.length,
      truncated
    }
  }

  private async postgresSchema(row: DbConnection): Promise<SqliteTableInfo[]> {
    return this.withPgClient(row, async (client) => {
      const listed = await client.query<{ nsp: string; name: string; estimate: string }>(
        PG_SCHEMA_TABLES_SQL
      )
      return assemblePostgresSchema(
        listed.rows.map((item) => ({
          schema: item.nsp,
          name: item.name,
          estimate: Number(item.estimate ?? 0)
        }))
      ).tables
    })
  }

  private async mysqlSchema(row: DbConnection): Promise<SqliteTableInfo[]> {
    const conn = await this.mysqlConn(row)
    try {
      const [listed] = await conn.query(
        `SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS name
         FROM information_schema.tables
         WHERE TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
         ORDER BY TABLE_SCHEMA, TABLE_NAME`
      )
      const items = Array.isArray(listed) ? (listed as Array<{ schema: string; name: string }>) : []
      const current = row.database.trim()
      const tables: SqliteTableInfo[] = []
      for (const item of items) {
        const qualified = item.schema === current || !current ? item.name : `${item.schema}.${item.name}`
        const [cols] = await conn.query(
          `SELECT COLUMN_NAME AS column_name
           FROM information_schema.columns
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
           ORDER BY ORDINAL_POSITION`,
          [item.schema, item.name]
        )
        const [countRows] = await conn.query(
          `SELECT COUNT(*) AS c FROM ${tableSqlName('mysql', `${item.schema}.${item.name}`)}`
        )
        const colList = Array.isArray(cols) ? (cols as Array<{ column_name: string }>) : []
        const totalRow = Array.isArray(countRows) ? (countRows[0] as { c?: unknown }) : undefined
        tables.push({
          name: qualified,
          columns: colList.map((col) => col.column_name),
          rowCount: Number(totalRow?.c ?? 0)
        })
      }
      return tables
    } finally {
      conn.release()
    }
  }

  private async clickhouseSchema(row: DbConnection): Promise<SqliteTableInfo[]> {
    const client = await this.clickhouse(row)
    const listed = await this.clickhouseRows(
      client,
      `SELECT database, name
       FROM system.tables
       WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
       ORDER BY database, name`
    )
    const current = row.database.trim()
    const tables: SqliteTableInfo[] = []
    for (const item of listed.rows) {
      const schema = String(item[0] ?? '')
      const name = String(item[1] ?? '')
      const qualified = schema === current || !current ? name : `${schema}.${name}`
      const cols = await this.clickhouseRows(
        client,
        `SELECT name FROM system.columns
         WHERE database = {db:String} AND table = {tbl:String}
         ORDER BY position`,
        { db: schema, tbl: name }
      )
      const count = await this.clickhouseRows(
        client,
        `SELECT count() FROM ${tableSqlName('clickhouse', `${schema}.${name}`)}`
      )
      tables.push({
        name: qualified,
        columns: cols.rows.map((col) => String(col[0] ?? '')),
        rowCount: Number(count.rows[0]?.[0] ?? 0)
      })
    }
    return tables
  }

  private async bigquerySchema(row: DbConnection): Promise<SqliteTableInfo[]> {
    const client = await this.bigquery(row)
    const project = bigqueryProjectOf(row)
    if (!project) throw new Error('BigQuery project is required')
    const datasetFilter = bigqueryDatasetOf(row)
    const [datasets] = await client.getDatasets({ projectId: project })
    const tables: SqliteTableInfo[] = []
    for (const dataset of datasets) {
      const datasetId = dataset.id ?? ''
      if (datasetFilter && datasetId !== datasetFilter) continue
      const [listed] = await dataset.getTables()
      for (const table of listed) {
        const tableId = table.id ?? ''
        const qualified = datasetFilter ? tableId : `${datasetId}.${tableId}`
        const [meta] = await table.getMetadata()
        const fields = (meta.schema?.fields ?? []) as Array<{ name?: string }>
        tables.push({
          name: qualified,
          columns: fields.map((field) => field.name ?? ''),
          rowCount: Number(meta.numRows ?? 0)
        })
      }
    }
    return tables
  }

  private async duckdbSchema(row: DbConnection): Promise<SqliteTableInfo[]> {
    const conn = await this.duckdb(row)
    const listed = await conn.run(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
       ORDER BY table_schema, table_name`
    )
    const items = await listed.getRows()
    const tables: SqliteTableInfo[] = []
    for (const item of items) {
      const schema = String(item[0] ?? '')
      const name = String(item[1] ?? '')
      const qualified = schema === 'main' ? name : `${schema}.${name}`
      const colsRes = await conn.run(`DESCRIBE ${tableSqlName('duckdb', qualified)}`)
      const colsRows = await colsRes.getRows()
      const countRes = await conn.run(`SELECT count(*) FROM ${tableSqlName('duckdb', qualified)}`)
      const countRows = await countRes.getRows()
      tables.push({
        name: qualified,
        columns: colsRows.map((col) => String(col[0] ?? '')),
        rowCount: Number(countRows[0]?.[0] ?? 0)
      })
    }
    return tables
  }

  private async withPgClient<T>(
    row: DbConnection,
    fn: (client: PgClient) => Promise<T>
  ): Promise<T> {
    const pending = this.pgClient(row)
    let client: PgClient | undefined
    try {
      client = await withTimeout(pending, PG_CONNECT_TIMEOUT_MS, 'Connect')
    } catch (err) {
      void pending.then((acquired) => acquired.release()).catch(() => undefined)
      this.evict(row.id)
      throw err
    }
    try {
      try {
        await withTimeout(
          client.query(`SET statement_timeout = ${PG_STATEMENT_TIMEOUT_MS}`),
          2_000,
          'Timeout'
        )
      } catch {
        // Pool already sends statement_timeout; some roles cannot SET.
      }
      return await withTimeout(fn(client), PG_STATEMENT_TIMEOUT_MS, 'Query')
    } finally {
      client.release()
    }
  }

  private async pgClient(row: DbConnection): Promise<PgClient> {
    const handle = await this.ensure(row, async (password) => {
      const { Pool } = await import('pg')
      return {
        kind: 'postgres',
        pool: new Pool({
          ...this.pgConfig(row, password),
          max: 2,
          connectionTimeoutMillis: PG_CONNECT_TIMEOUT_MS,
          idleTimeoutMillis: 30_000,
          statement_timeout: PG_STATEMENT_TIMEOUT_MS,
          query_timeout: PG_STATEMENT_TIMEOUT_MS
        }),
        fingerprint: fingerprintOf(row, password),
        lastAccess: Date.now()
      }
    })
    if (handle.kind !== 'postgres') throw new Error('Expected postgres handle')
    return handle.pool.connect()
  }

  private async mysqlConn(row: DbConnection): Promise<MysqlConn> {
    const handle = await this.ensure(row, async (password) => {
      const mysql = await import('mysql2/promise')
      return {
        kind: 'mysql',
        pool: mysql.createPool({
          ...this.mysqlConfig(row, password),
          waitForConnections: true,
          connectionLimit: 2,
          connectTimeout: 8000,
          enableKeepAlive: true
        }),
        fingerprint: fingerprintOf(row, password),
        lastAccess: Date.now()
      }
    })
    if (handle.kind !== 'mysql') throw new Error('Expected mysql handle')
    return handle.pool.getConnection()
  }

  private async clickhouse(row: DbConnection): Promise<ClickHouseClient> {
    const handle = await this.ensure(row, async (password) => {
      const { createClient } = await import('@clickhouse/client')
      return {
        kind: 'clickhouse',
        client: createClient(this.clickhouseConfig(row, password)),
        fingerprint: fingerprintOf(row, password),
        lastAccess: Date.now()
      }
    })
    if (handle.kind !== 'clickhouse') throw new Error('Expected clickhouse handle')
    return handle.client
  }

  private async bigquery(row: DbConnection): Promise<BigQueryClient> {
    const handle = await this.ensure(row, async (password) => {
      const { BigQuery } = await import('@google-cloud/bigquery')
      return {
        kind: 'bigquery',
        client: new BigQuery(this.bigqueryConfig(row, password)),
        fingerprint: fingerprintOf(row, password),
        lastAccess: Date.now()
      }
    })
    if (handle.kind !== 'bigquery') throw new Error('Expected bigquery handle')
    return handle.client
  }

  private async duckdb(row: DbConnection): Promise<DuckDBConnection> {
    const handle = await this.ensure(row, async (password) => {
      const path = duckdbPathOf(row)
      if (path !== ':memory:' && !existsSync(path)) {
        throw new Error(`DuckDB file not found: ${path}`)
      }
      const { DuckDBInstance } = await import('@duckdb/node-api')
      const inst = await DuckDBInstance.create(path)
      return {
        kind: 'duckdb',
        inst,
        conn: await inst.connect(),
        fingerprint: fingerprintOf(row, password),
        lastAccess: Date.now()
      }
    })
    if (handle.kind !== 'duckdb') throw new Error('Expected duckdb handle')
    return handle.conn
  }

  private async ensure(
    row: DbConnection,
    create: (password: string | null) => Promise<CachedHandle>
  ): Promise<CachedHandle> {
    const password = this.store.password(row.id)
    const fingerprint = fingerprintOf(row, password)
    let entry = this.cache.get(row.id)
    if (!entry || entry.fingerprint !== fingerprint) {
      if (entry) void this.dispose(entry)
      entry = await create(password)
      this.cache.set(row.id, entry)
      this.evictLru()
    }
    entry.lastAccess = Date.now()
    return entry
  }

  private pgConfig(
    row: DbConnection,
    password: string | null
  ): {
    connectionString?: string
    host?: string
    port?: number
    database?: string
    user?: string
    password?: string
    ssl?: { rejectUnauthorized: false }
  } {
    const ssl = row.ssl ? { rejectUnauthorized: false as const } : undefined
    if (row.useUrl) {
      const parsed = parseDbUrl(row.url, 'postgres')
      if (!parsed) throw new Error('Invalid connection URL')
      return {
        connectionString: dbUrlWithPassword(parsed.url, password, 'postgres'),
        ssl
      }
    }
    return {
      host: row.host || 'localhost',
      port: row.port,
      database: row.database || undefined,
      user: row.user || undefined,
      password: password || undefined,
      ssl
    }
  }

  private mysqlConfig(
    row: DbConnection,
    password: string | null
  ): {
    uri?: string
    host?: string
    port?: number
    database?: string
    user?: string
    password?: string
    ssl?: { rejectUnauthorized: false } | undefined
  } {
    const ssl = row.ssl ? { rejectUnauthorized: false as const } : undefined
    if (row.useUrl) {
      const parsed = parseDbUrl(row.url, 'mysql')
      if (!parsed) throw new Error('Invalid connection URL')
      return {
        uri: dbUrlWithPassword(parsed.url, password, 'mysql'),
        ssl
      }
    }
    return {
      host: row.host || 'localhost',
      port: row.port || 3306,
      database: row.database || undefined,
      user: row.user || undefined,
      password: password || undefined,
      ssl
    }
  }

  private clickhouseConfig(
    row: DbConnection,
    password: string | null
  ): {
    url: string
    username?: string
    password?: string
    database?: string
    request_timeout: number
  } {
    if (row.useUrl) {
      const parsed = parseDbUrl(row.url, 'clickhouse')
      if (!parsed) throw new Error('Invalid connection URL')
      const raw = dbUrlWithPassword(parsed.url, password, 'clickhouse')
      const http = clickhouseHttpUrl(raw, parsed.ssl || row.ssl)
      return {
        url: http,
        username: parsed.user || undefined,
        password: password || parsed.password || undefined,
        database: parsed.database || undefined,
        request_timeout: 15_000
      }
    }
    const protocol = row.ssl ? 'https' : 'http'
    const port = row.port || (row.ssl ? 8443 : 8123)
    return {
      url: `${protocol}://${row.host || 'localhost'}:${port}`,
      username: row.user || undefined,
      password: password || undefined,
      database: row.database || undefined,
      request_timeout: 15_000
    }
  }

  private bigqueryConfig(
    row: DbConnection,
    password: string | null
  ): {
    projectId?: string
    location?: string
    keyFilename?: string
    credentials?: { client_email?: string; private_key?: string }
  } {
    const projectId = bigqueryProjectOf(row) || undefined
    const location = bigqueryLocationOf(row)
    const secret = password?.trim() || ''
    if (secret.startsWith('{')) {
      try {
        return {
          projectId,
          location,
          credentials: JSON.parse(secret) as { client_email?: string; private_key?: string }
        }
      } catch {
        throw new Error('Invalid BigQuery service-account JSON')
      }
    }
    if (secret) return { projectId, location, keyFilename: secret }
    if (row.useUrl && row.url.trim() && !row.url.trim().startsWith('bigquery:')) {
      return { projectId, location, keyFilename: row.url.trim() }
    }
    return { projectId, location }
  }

  private async clickhouseRows(
    client: ClickHouseClient,
    query: string,
    query_params?: Record<string, unknown>
  ): Promise<{ columns: string[]; rows: string[][] }> {
    const result = await client.query({ query, query_params, format: 'JSONEachRow' })
    const records = (await result.json()) as Array<Record<string, unknown>>
    const columns = records[0] ? Object.keys(records[0]) : []
    if (!columns.length) {
      const empty = await client.query({ query, query_params, format: 'JSONCompact' })
      const compact = (await empty.json()) as { meta?: Array<{ name: string }>; data?: unknown[][] }
      return {
        columns: compact.meta?.map((col) => col.name) ?? [],
        rows: (compact.data ?? []).map((record) => record.map(cellToString))
      }
    }
    return {
      columns,
      rows: records.map((record) => columns.map((col) => cellToString(record[col])))
    }
  }

  private bigqueryColumns(job: { metadata?: { schema?: { fields?: Array<{ name?: string }> } } }): string[] {
    return (job.metadata?.schema?.fields ?? []).map((field) => field.name ?? '').filter(Boolean)
  }

  private evictLru(): void {
    if (this.cache.size <= POOL_MAX) return
    const ordered = [...this.cache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)
    const drop = ordered.length - POOL_MAX
    for (let i = 0; i < drop; i++) {
      const [id, entry] = ordered[i]!
      this.cache.delete(id)
      void this.dispose(entry)
    }
  }

  private async dispose(entry: CachedHandle): Promise<void> {
    try {
      if (entry.kind === 'postgres') await entry.pool.end()
      else if (entry.kind === 'mysql') await entry.pool.end()
      else if (entry.kind === 'clickhouse') await entry.client.close()
    } catch {
      /* ignore */
    }
  }
}

function clickhouseHttpUrl(raw: string, ssl: boolean): string {
  try {
    const parsed = new URL(raw)
    if (parsed.protocol === 'clickhouse:' || parsed.protocol === 'clickhouses:') {
      parsed.protocol = parsed.protocol === 'clickhouses:' || ssl ? 'https:' : 'http:'
      if (!parsed.port) parsed.port = parsed.protocol === 'https:' ? '8443' : '8123'
    }
    parsed.password = ''
    return parsed.toString()
  } catch {
    return raw
  }
}
