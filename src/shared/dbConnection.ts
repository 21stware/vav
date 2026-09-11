/**
 * Live database connections. A connection is bound to a `sessionKind: 'db'`
 * conversation — the create surface is the connection form; after a successful
 * connect the same session reuses the CSV / SQLite preview + `sql_query` agent.
 */

export const DB_DRIVERS = ['postgres', 'mysql', 'sqlite', 'sqlserver'] as const
export type DbDriver = (typeof DB_DRIVERS)[number]

/** Drivers the connect UI can switch to. Only postgres is implemented. */
export const DB_DRIVER_IMPLEMENTED: readonly DbDriver[] = ['postgres']

export const DB_DRIVER_DEFAULTS: Record<DbDriver, { port: number; label: string }> = {
  postgres: { port: 5432, label: 'PostgreSQL' },
  mysql: { port: 3306, label: 'MySQL' },
  sqlite: { port: 0, label: 'SQLite' },
  sqlserver: { port: 1433, label: 'SQL Server' }
}

export type DbConnectionStatus = 'ok' | 'failed' | null

export interface DbConnection {
  id: string
  title: string
  conversationId: string | null
  driver: DbDriver
  host: string
  port: number
  database: string
  user: string
  ssl: boolean
  hasPassword: boolean
  createdAt: number
  updatedAt: number
  lastConnectedAt: number | null
  lastStatus: DbConnectionStatus
  lastError: string | null
}

export interface DbConnectionInput {
  title?: string
  conversationId?: string | null
  driver?: DbDriver
  host?: string
  port?: number
  database?: string
  user?: string
  ssl?: boolean
  /** Write-only. Omit to keep the stored password; empty string clears it. */
  password?: string
}

export function isDbDriver(value: unknown): value is DbDriver {
  return typeof value === 'string' && (DB_DRIVERS as readonly string[]).includes(value)
}

export function defaultDbPort(driver: DbDriver): number {
  return DB_DRIVER_DEFAULTS[driver].port
}

export function defaultDbConnectionInput(): Required<
  Omit<DbConnectionInput, 'password' | 'conversationId' | 'title'>
> {
  return {
    driver: 'postgres',
    host: 'localhost',
    port: 5432,
    database: '',
    user: '',
    ssl: false
  }
}

export function clampDbPort(value: number, driver: DbDriver = 'postgres'): number {
  if (!Number.isFinite(value) || value <= 0) return defaultDbPort(driver)
  return Math.min(65535, Math.max(1, Math.round(value)))
}

export function dbConnectionTitle(row: Pick<DbConnection, 'title' | 'database' | 'host' | 'driver'>): string {
  const title = row.title.trim()
  if (title) return title
  if (row.database.trim() && row.host.trim()) return `${row.database.trim()}@${row.host.trim()}`
  if (row.database.trim()) return row.database.trim()
  if (row.host.trim()) return row.host.trim()
  return DB_DRIVER_DEFAULTS[row.driver].label
}

export function isReadOnlySql(sql: string): boolean {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim()
  if (!stripped) return false
  const first = stripped.replace(/^\(+/, '').trim()
  return /^(select|with|show|explain|describe|table|values)\b/i.test(first)
}

export function isSingleSqlStatement(sql: string): boolean {
  const trimmed = sql.trim().replace(/;+\s*$/, '')
  return trimmed.length > 0 && !trimmed.includes(';')
}
