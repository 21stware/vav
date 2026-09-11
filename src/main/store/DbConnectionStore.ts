import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  clampDbPort,
  dbConnectionTitle,
  dbDriverFormKind,
  defaultDbConnectionInput,
  defaultDbPort,
  isDbDriver,
  parseDbUrl,
  type DbConnection,
  type DbConnectionInput,
  type DbConnectionStatus,
  type DbDriver
} from '../../shared/dbConnection.ts'

function sanitizeStoredUrl(raw: string, driver?: DbDriver): string {
  const parsed = parseDbUrl(raw, driver)
  return parsed ? parsed.url : raw.trim()
}

export type DbPasswordVault = {
  get(id: string): string | null
  set(id: string, password: string): void
  clear(id: string): void
}

function coerceConnection(raw: unknown): DbConnection | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id.trim()) return null
  const driver: DbDriver = isDbDriver(row.driver) ? row.driver : 'postgres'
  const createdAt = typeof row.createdAt === 'number' ? row.createdAt : Date.now()
  const lastStatus: DbConnectionStatus =
    row.lastStatus === 'ok' || row.lastStatus === 'failed' ? row.lastStatus : null
  return {
    id: row.id,
    title: typeof row.title === 'string' ? row.title : '',
    conversationId:
      typeof row.conversationId === 'string' && row.conversationId.trim()
        ? row.conversationId
        : null,
    driver,
    host: typeof row.host === 'string' ? row.host : '',
    port: clampDbPort(typeof row.port === 'number' ? row.port : 0, driver),
    database: typeof row.database === 'string' ? row.database : '',
    user: typeof row.user === 'string' ? row.user : '',
    ssl: row.ssl === true,
    useUrl: row.useUrl === true,
    url: sanitizeStoredUrl(typeof row.url === 'string' ? row.url : '', driver),
    hasPassword: false,
    createdAt,
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : createdAt,
    lastConnectedAt: typeof row.lastConnectedAt === 'number' ? row.lastConnectedAt : null,
    lastStatus,
    lastError: typeof row.lastError === 'string' ? row.lastError : null
  }
}

export class DbConnectionStore {
  private readonly path: string
  private rows: DbConnection[] = []
  private readonly vault: DbPasswordVault

  constructor(stateDir: string, vault: DbPasswordVault) {
    this.path = join(stateDir, 'db-connections', 'connections.json')
    this.vault = vault
  }

  load(): void {
    this.rows = this.readList()
    for (const row of this.rows) this.adoptUrlPassword(row)
  }

  list(): DbConnection[] {
    return this.rows.map((row) => this.publicRow(row))
  }

  get(id: string): DbConnection | undefined {
    const row = this.rows.find((item) => item.id === id)
    return row ? this.publicRow(row) : undefined
  }

  getForConversation(conversationId: string): DbConnection | undefined {
    const id = conversationId.trim()
    if (!id) return undefined
    const row = this.rows.find((item) => item.conversationId === id)
    return row ? this.publicRow(row) : undefined
  }

  password(id: string): string | null {
    return this.vault.get(id)
  }

  create(input: DbConnectionInput = {}, now = Date.now()): DbConnection {
    const defaults = defaultDbConnectionInput()
    const driver = isDbDriver(input.driver) ? input.driver : defaults.driver
    const server = dbDriverFormKind(driver) === 'server'
    const row: DbConnection = {
      id: randomUUID(),
      title: (input.title ?? '').trim(),
      conversationId: input.conversationId?.trim() || null,
      driver,
      host: (input.host ?? (server ? defaults.host : '')).trim(),
      port: clampDbPort(input.port ?? defaultDbPort(driver), driver),
      database: (input.database ?? '').trim(),
      user: (input.user ?? '').trim(),
      ssl: input.ssl === true,
      useUrl: input.useUrl === true,
      url: '',
      hasPassword: false,
      createdAt: now,
      updatedAt: now,
      lastConnectedAt: null,
      lastStatus: null,
      lastError: null
    }
    this.applyUrl(row, input.url, input.password)
    if (typeof input.password === 'string' && input.password.length > 0) {
      this.vault.set(row.id, input.password)
    }
    this.rows.unshift(row)
    this.persist()
    return this.publicRow(row)
  }

  update(id: string, patch: DbConnectionInput, now = Date.now()): DbConnection | null {
    const row = this.rows.find((item) => item.id === id)
    if (!row) return null
    if (typeof patch.title === 'string') row.title = patch.title.trim()
    if (patch.conversationId !== undefined) {
      row.conversationId = patch.conversationId?.trim() || null
    }
    if (isDbDriver(patch.driver)) {
      row.driver = patch.driver
      if (patch.port === undefined) row.port = clampDbPort(row.port, patch.driver)
    }
    if (typeof patch.host === 'string') row.host = patch.host.trim()
    if (typeof patch.port === 'number') row.port = clampDbPort(patch.port, row.driver)
    if (typeof patch.database === 'string') row.database = patch.database.trim()
    if (typeof patch.user === 'string') row.user = patch.user.trim()
    if (typeof patch.ssl === 'boolean') row.ssl = patch.ssl
    if (typeof patch.useUrl === 'boolean') row.useUrl = patch.useUrl
    this.applyUrl(row, patch.url, patch.password)
    if (typeof patch.password === 'string') {
      if (patch.password.length > 0) this.vault.set(row.id, patch.password)
      else this.vault.clear(row.id)
    }
    row.updatedAt = now
    this.persist()
    return this.publicRow(row)
  }

  markStatus(
    id: string,
    status: Exclude<DbConnectionStatus, null>,
    error: string | null,
    now = Date.now()
  ): DbConnection | null {
    const row = this.rows.find((item) => item.id === id)
    if (!row) return null
    row.lastStatus = status
    row.lastError = error
    row.updatedAt = now
    if (status === 'ok') row.lastConnectedAt = now
    this.persist()
    return this.publicRow(row)
  }

  remove(id: string): boolean {
    const before = this.rows.length
    this.rows = this.rows.filter((row) => row.id !== id)
    if (this.rows.length === before) return false
    this.vault.clear(id)
    this.persist()
    return true
  }

  removeForConversation(conversationId: string): boolean {
    const row = this.rows.find((item) => item.conversationId === conversationId)
    return row ? this.remove(row.id) : false
  }

  displayTitle(row: DbConnection): string {
    return dbConnectionTitle(row)
  }

  private applyUrl(row: DbConnection, raw: string | undefined, password: string | undefined): void {
    if (typeof raw !== 'string') return
    const parsed = parseDbUrl(raw, row.driver)
    if (!parsed) {
      row.url = raw.trim()
      return
    }
    row.url = parsed.url
    if (parsed.password && password === undefined) this.vault.set(row.id, parsed.password)
    if (!row.useUrl) return
    row.host = parsed.host
    row.port = parsed.port
    row.database = parsed.database
    row.user = parsed.user
    row.ssl = parsed.ssl
  }

  private adoptUrlPassword(row: DbConnection): void {
    const parsed = parseDbUrl(row.url, row.driver)
    if (!parsed) return
    row.url = parsed.url
    if (parsed.password && !this.vault.get(row.id)) this.vault.set(row.id, parsed.password)
  }

  private publicRow(row: DbConnection): DbConnection {
    return { ...row, hasPassword: Boolean(this.vault.get(row.id)) }
  }

  private readList(): DbConnection[] {
    try {
      if (!existsSync(this.path)) return []
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown
      const rows = Array.isArray(parsed) ? parsed : []
      return rows.map(coerceConnection).filter((row): row is DbConnection => row != null)
    } catch {
      return []
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const disk = this.rows.map(({ hasPassword: _hasPassword, ...row }) => {
        void _hasPassword
        return row
      })
      writeFileSync(this.path, JSON.stringify(disk, null, 2), 'utf8')
    } catch (err) {
      console.error('[db] persist failed', err)
    }
  }
}
