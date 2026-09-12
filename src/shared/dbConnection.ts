/**
 * Live database connections. A connection is bound to a `sessionKind: 'db'`
 * conversation — the create surface is the connection form; after a successful
 * connect the same session reuses the CSV / SQLite preview + `sql_query` agent.
 */

export const DB_DRIVERS = [
  'postgres',
  'mysql',
  'clickhouse',
  'bigquery',
  'duckdb',
  'sqlite',
  'sqlserver'
] as const
export type DbDriver = (typeof DB_DRIVERS)[number]

export const DB_DRIVER_IMPLEMENTED: readonly DbDriver[] = [
  'postgres',
  'mysql',
  'clickhouse',
  'bigquery',
  'duckdb'
]

export const DB_DRIVER_DEFAULTS: Record<DbDriver, { port: number; label: string }> = {
  postgres: { port: 5432, label: 'PostgreSQL' },
  mysql: { port: 3306, label: 'MySQL' },
  clickhouse: { port: 8123, label: 'ClickHouse' },
  bigquery: { port: 0, label: 'BigQuery' },
  duckdb: { port: 0, label: 'DuckDB' },
  sqlite: { port: 0, label: 'SQLite' },
  sqlserver: { port: 1433, label: 'SQL Server' }
}

export type DbConnectionStatus = 'ok' | 'failed' | null

export type DbFormKind = 'server' | 'file' | 'cloud'

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
  /** When true the form + driver client use `url` instead of discrete fields. */
  useUrl: boolean
  /** Password-redacted connection URL. Password lives in the vault. */
  url: string
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
  useUrl?: boolean
  url?: string
  /** Write-only. Omit to keep the stored password; empty string clears it. */
  password?: string
}

export interface ParsedDbUrl {
  driver: DbDriver
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl: boolean
  /** Same URL with the password stripped. */
  url: string
}

/** @deprecated Use {@link ParsedDbUrl}. */
export type ParsedPostgresUrl = ParsedDbUrl

const URL_PROTOCOL_DRIVERS: Record<string, DbDriver> = {
  'postgres:': 'postgres',
  'postgresql:': 'postgres',
  'mysql:': 'mysql',
  'mysql2:': 'mysql',
  'clickhouse:': 'clickhouse',
  'clickhouses:': 'clickhouse',
  'ch:': 'clickhouse',
  'bigquery:': 'bigquery',
  'duckdb:': 'duckdb',
  'sqlite:': 'sqlite',
  'sqlserver:': 'sqlserver',
  'mssql:': 'sqlserver'
}

export function isDbDriver(value: unknown): value is DbDriver {
  return typeof value === 'string' && (DB_DRIVERS as readonly string[]).includes(value)
}

export function isDbDriverImplemented(value: unknown): value is DbDriver {
  return typeof value === 'string' && (DB_DRIVER_IMPLEMENTED as readonly string[]).includes(value)
}

export function defaultDbPort(driver: DbDriver): number {
  return DB_DRIVER_DEFAULTS[driver].port
}

export function dbDriverFormKind(driver: DbDriver): DbFormKind {
  if (driver === 'duckdb' || driver === 'sqlite') return 'file'
  if (driver === 'bigquery') return 'cloud'
  return 'server'
}

export function dbDriverUsesHostPort(driver: DbDriver): boolean {
  return dbDriverFormKind(driver) === 'server'
}

export function dbDriverUsesAuth(driver: DbDriver): boolean {
  return driver !== 'duckdb' && driver !== 'sqlite'
}

export function dbDriverUsesSsl(driver: DbDriver): boolean {
  return dbDriverFormKind(driver) === 'server'
}

export function dbUrlPlaceholder(driver: DbDriver): string {
  switch (driver) {
    case 'mysql':
      return 'mysql://user:password@host:3306/dbname'
    case 'clickhouse':
      return 'clickhouse://user:password@host:8123/dbname'
    case 'bigquery':
      return 'bigquery://project/dataset?location=US'
    case 'duckdb':
      return 'duckdb:///path/to/file.duckdb'
    case 'sqlite':
      return 'sqlite:///path/to/file.sqlite'
    case 'sqlserver':
      return 'sqlserver://user:password@host:1433/dbname'
    default:
      return 'postgresql://user:password@host:5432/dbname'
  }
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
    ssl: false,
    useUrl: false,
    url: ''
  }
}

export function clampDbPort(value: number, driver: DbDriver = 'postgres'): number {
  if (dbDriverFormKind(driver) !== 'server') return 0
  if (!Number.isFinite(value) || value <= 0) return defaultDbPort(driver)
  return Math.min(65535, Math.max(1, Math.round(value)))
}

function fileBaseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '').trim()
  if (!trimmed) return ''
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] ?? trimmed
}

export function dbConnectionTitle(
  row: Pick<DbConnection, 'title' | 'database' | 'host' | 'driver' | 'user'>
): string {
  const title = row.title.trim()
  if (title) return title
  const kind = dbDriverFormKind(row.driver)
  if (kind === 'file') {
    return fileBaseName(row.database) || DB_DRIVER_DEFAULTS[row.driver].label
  }
  if (row.driver === 'bigquery') {
    if (row.user.trim() && row.database.trim()) return `${row.user.trim()}@${row.database.trim()}`
    if (row.database.trim()) return row.database.trim()
    return DB_DRIVER_DEFAULTS.bigquery.label
  }
  if (row.database.trim() && row.host.trim()) return `${row.database.trim()}@${row.host.trim()}`
  if (row.database.trim()) return row.database.trim()
  if (row.host.trim()) return row.host.trim()
  return DB_DRIVER_DEFAULTS[row.driver].label
}

export function dbConnectionSubtitle(
  row: Pick<DbConnection, 'driver' | 'host' | 'database' | 'user'>
): string {
  if (row.driver === 'duckdb' || row.driver === 'sqlite') return row.database.trim()
  if (row.driver === 'bigquery') {
    const project = row.database.trim()
    const dataset = row.user.trim()
    if (project && dataset) return `${project} / ${dataset}`
    return project
  }
  const host = row.host.trim()
  const database = row.database.trim()
  if (host && database) return `${host} / ${database}`
  return host || database
}

export function isReadOnlySql(sql: string): boolean {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim()
  if (!stripped) return false
  const first = stripped.replace(/^\(+/, '').trim()
  return /^(select|with|show|explain|describe|desc|table|values|pragma)\b/i.test(first)
}

export function isSingleSqlStatement(sql: string): boolean {
  const trimmed = sql.trim().replace(/;+\s*$/, '')
  return trimmed.length > 0 && !trimmed.includes(';')
}

function driverFromProtocol(protocol: string): DbDriver | null {
  return URL_PROTOCOL_DRIVERS[protocol] ?? null
}

function sslFromSearch(parsed: URL): boolean | null {
  const mode = (parsed.searchParams.get('sslmode') ?? parsed.searchParams.get('ssl-mode') ?? '')
    .toLowerCase()
  if (mode === 'require' || mode === 'verify-ca' || mode === 'verify-full' || mode === 'prefer') {
    return true
  }
  if (mode === 'disable' || mode === 'allow') return false
  const ssl = (parsed.searchParams.get('ssl') ?? parsed.searchParams.get('secure') ?? '').toLowerCase()
  if (ssl === 'true' || ssl === '1') return true
  if (ssl === 'false' || ssl === '0') return false
  return null
}

function redactUrl(parsed: URL): string {
  const next = new URL(parsed.toString())
  next.password = ''
  return next.toString()
}

function decodePathSegment(path: string): string {
  const trimmed = path.replace(/^\/+/, '').split('/')[0] ?? ''
  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

function duckdbPathFromUrl(parsed: URL): string {
  if (parsed.hostname && parsed.hostname !== 'localhost') {
    const rest = parsed.pathname.replace(/^\/+/, '')
    return rest ? `${parsed.hostname}/${rest}` : parsed.hostname
  }
  let path = parsed.pathname || ''
  try {
    path = decodeURIComponent(path)
  } catch {
    /* keep */
  }
  if (/^\/[A-Za-z]:[\\/]/.test(path)) return path.slice(1)
  if (path === '/:memory:' || path === ':memory:') return ':memory:'
  return path
}

function parseHttpClickhouseUrl(parsed: URL): ParsedDbUrl | null {
  const host = parsed.hostname.trim()
  if (!host) return null
  const ssl = parsed.protocol === 'https:' || sslFromSearch(parsed) === true
  const database = decodePathSegment(parsed.pathname)
  return {
    driver: 'clickhouse',
    host,
    port: clampDbPort(parsed.port ? Number(parsed.port) : ssl ? 8443 : 8123, 'clickhouse'),
    database,
    user: parsed.username,
    password: parsed.password,
    ssl,
    url: redactUrl(parsed)
  }
}

function parseBigqueryUrl(parsed: URL): ParsedDbUrl | null {
  const project = parsed.hostname.trim() || decodePathSegment(parsed.pathname)
  if (!project) return null
  const rest = parsed.pathname.replace(/^\/+/, '')
  const dataset = parsed.hostname.trim() ? rest.split('/')[0] ?? '' : ''
  const location = (parsed.searchParams.get('location') ?? '').trim()
  return {
    driver: 'bigquery',
    host: location,
    port: 0,
    database: project,
    user: dataset,
    password: parsed.password,
    ssl: true,
    url: redactUrl(parsed)
  }
}

function parseDuckdbUrl(parsed: URL): ParsedDbUrl | null {
  const database = duckdbPathFromUrl(parsed).trim()
  if (!database) return null
  return {
    driver: 'duckdb',
    host: '',
    port: 0,
    database,
    user: parsed.username,
    password: parsed.password,
    ssl: false,
    url: redactUrl(parsed)
  }
}

function parseServerUrl(parsed: URL, driver: DbDriver): ParsedDbUrl | null {
  const host = parsed.hostname.trim()
  if (!host) return null
  const sslHint = sslFromSearch(parsed)
  const ssl =
    sslHint ??
    (parsed.protocol === 'clickhouses:' || parsed.protocol === 'https:')
  return {
    driver,
    host,
    port: clampDbPort(parsed.port ? Number(parsed.port) : 0, driver),
    database: decodePathSegment(parsed.pathname),
    user: parsed.username,
    password: parsed.password,
    ssl,
    url: redactUrl(parsed)
  }
}

export function parseDbUrl(raw: string, hint?: DbDriver): ParsedDbUrl | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  if (hint === 'duckdb' && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return {
      driver: 'duckdb',
      host: '',
      port: 0,
      database: trimmed,
      user: '',
      password: '',
      ssl: false,
      url: trimmed
    }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol === 'http:' || protocol === 'https:') {
    return hint === 'clickhouse' ? parseHttpClickhouseUrl(parsed) : null
  }

  const driver = driverFromProtocol(protocol)
  if (!driver) return null
  if (hint && driver !== hint) return null

  if (driver === 'bigquery') return parseBigqueryUrl(parsed)
  if (driver === 'duckdb') return parseDuckdbUrl(parsed)
  if (driver === 'sqlite') {
    const database = duckdbPathFromUrl(parsed).trim()
    if (!database) return null
    return {
      driver,
      host: '',
      port: 0,
      database,
      user: '',
      password: '',
      ssl: false,
      url: redactUrl(parsed)
    }
  }
  return parseServerUrl(parsed, driver)
}

export function parsePostgresUrl(raw: string): ParsedDbUrl | null {
  return parseDbUrl(raw, 'postgres')
}

export function formatDbUrl(row: {
  driver: DbDriver
  host: string
  port: number
  database: string
  user: string
  ssl: boolean
}): string {
  if (row.driver === 'duckdb' || row.driver === 'sqlite') {
    const path = row.database.trim() || ':memory:'
    if (path === ':memory:') return 'duckdb:///:memory:'
    const encoded = path.replace(/\\/g, '/')
    return encoded.startsWith('/') ? `duckdb://${encoded}` : `duckdb:///${encoded}`
  }
  if (row.driver === 'bigquery') {
    const project = row.database.trim() || 'project'
    const dataset = row.user.trim()
    const url = new URL(`bigquery://${project}`)
    url.pathname = dataset ? `/${dataset}` : '/'
    const location = row.host.trim()
    if (location) url.searchParams.set('location', location)
    return url.toString()
  }
  const protocol =
    row.driver === 'mysql'
      ? 'mysql:'
      : row.driver === 'clickhouse'
        ? row.ssl
          ? 'clickhouses:'
          : 'clickhouse:'
        : row.driver === 'sqlserver'
          ? 'sqlserver:'
          : 'postgresql:'
  const url = new URL(`${protocol}//localhost`)
  url.hostname = row.host.trim() || 'localhost'
  const port = clampDbPort(row.port, row.driver)
  if (port) url.port = String(port)
  url.username = row.user.trim()
  const database = row.database.trim()
  url.pathname = database ? `/${database}` : '/'
  if (row.driver === 'postgres') {
    if (row.ssl) url.searchParams.set('sslmode', 'require')
    else url.searchParams.delete('sslmode')
  } else if (row.driver === 'mysql') {
    if (row.ssl) url.searchParams.set('ssl', 'true')
    else url.searchParams.delete('ssl')
  }
  return url.toString()
}

export function formatPostgresUrl(row: {
  host: string
  port: number
  database: string
  user: string
  ssl: boolean
}): string {
  return formatDbUrl({ ...row, driver: 'postgres' })
}

export function setDbUrlSsl(raw: string, ssl: boolean, driver: DbDriver = 'postgres'): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    return formatDbUrl({
      driver,
      host: driver === 'bigquery' || driver === 'duckdb' ? '' : 'localhost',
      port: defaultDbPort(driver),
      database: '',
      user: '',
      ssl
    })
  }
  try {
    const parsed = new URL(trimmed)
    const parsedDriver = driverFromProtocol(parsed.protocol) ?? driver
    if (parsedDriver === 'clickhouse') {
      parsed.protocol = ssl ? 'clickhouses:' : 'clickhouse:'
      if (!parsed.port) parsed.port = String(ssl ? 8443 : 8123)
      parsed.searchParams.delete('secure')
      return parsed.toString()
    }
    if (parsedDriver !== 'postgres' && parsedDriver !== 'mysql') return trimmed
    if (parsedDriver === 'mysql') {
      if (ssl) parsed.searchParams.set('ssl', 'true')
      else parsed.searchParams.delete('ssl')
      return parsed.toString()
    }
    if (ssl) parsed.searchParams.set('sslmode', 'require')
    else {
      parsed.searchParams.delete('sslmode')
      parsed.searchParams.delete('ssl')
    }
    return parsed.toString()
  } catch {
    return trimmed
  }
}

export function setPostgresUrlSsl(raw: string, ssl: boolean): string {
  return setDbUrlSsl(raw, ssl, 'postgres')
}

export function dbUrlWithPassword(raw: string, password: string | null, driver?: DbDriver): string {
  const trimmed = raw.trim()
  if (!trimmed || !password) return trimmed
  try {
    const parsed = new URL(trimmed)
    const parsedDriver = driverFromProtocol(parsed.protocol)
    if (driver && parsedDriver && parsedDriver !== driver) return trimmed
    if (!parsedDriver && driver !== 'clickhouse') return trimmed
    parsed.password = password
    return parsed.toString()
  } catch {
    return trimmed
  }
}

export function postgresUrlWithPassword(raw: string, password: string | null): string {
  return dbUrlWithPassword(raw, password, 'postgres')
}

const DB_AUTH_ERROR =
  /password is missing|password must be a string|password authentication|SASL|SCRAM|28P01|fe_sendauth/i

/** Vault empty or driver rejected the secret — show the connection form, not a catalog error. */
export function isDbAuthError(message: string): boolean {
  return DB_AUTH_ERROR.test(message)
}
