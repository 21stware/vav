import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CliHostKind, ProviderResumeCursor } from '@shared/cliHost'
import { isStructuredCliHost } from '@shared/cliHost'
import { nativeSessionId } from '@shared/cliPaneBinding'
import type { SwarmSessionRecord } from '@shared/cliSessionHistory'
import { isBlankSwarmSessionTitle, swarmSessionKey } from '@shared/cliSessionHistory'

const FILE_VERSION = 1
const MAX_RECORDS = 500

type SwarmHistoryFile = {
  version: number
  records: SwarmSessionRecord[]
}

export type SwarmHistoryUpsert = {
  agentId: CliHostKind
  cursor: ProviderResumeCursor
  conversationId: string
  workingDirectory?: string
  title?: string | null
  name?: string | null
}

/**
 * Named native CLI sessions for Swarm History.
 * Independent of live PTY panes so close / workdir switch still resume.
 */
export class SwarmHistoryStore {
  private readonly file: string
  private records = new Map<string, SwarmSessionRecord>()
  private persistTimer: NodeJS.Timeout | null = null

  constructor(file: string) {
    this.file = file
  }

  load(): void {
    try {
      if (!existsSync(this.file)) {
        this.records.clear()
        return
      }
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<SwarmHistoryFile>
      const rows = Array.isArray(raw.records) ? raw.records : []
      this.records.clear()
      for (const row of rows) {
        const parsed = sanitizeRecord(row)
        if (parsed) this.records.set(parsed.key, parsed)
      }
    } catch (err) {
      console.error('[swarm-history] load failed, starting empty', err)
      this.records.clear()
    }
  }

  all(): SwarmSessionRecord[] {
    return [...this.records.values()]
  }

  forConversation(conversationId: string): SwarmSessionRecord[] {
    return this.all().filter((row) => row.conversationId === conversationId)
  }

  get(key: string): SwarmSessionRecord | undefined {
    return this.records.get(key)
  }

  remove(key: string): boolean {
    if (!this.records.has(key)) return false
    this.records.delete(key)
    this.schedulePersist()
    return true
  }

  upsert(input: SwarmHistoryUpsert): SwarmSessionRecord | null {
    const sessionId = nativeSessionId(input.cursor)
    if (!sessionId || !isStructuredCliHost(input.agentId)) return null
    const key = swarmSessionKey(input.agentId, sessionId)
    const prev = this.records.get(key)
    const now = Date.now()
    const next: SwarmSessionRecord = {
      key,
      agentId: input.agentId,
      cursor: input.cursor,
      name: input.name !== undefined ? clean(input.name) : (prev?.name ?? null),
      title:
        input.title !== undefined
          ? blankTitleToNull(clean(input.title))
          : blankTitleToNull(prev?.title ?? null),
      conversationId: input.conversationId || prev?.conversationId || '',
      workingDirectory: input.workingDirectory || prev?.workingDirectory || '~',
      createdAt: prev?.createdAt ?? now,
      updatedAt: now
    }
    this.records.set(key, next)
    this.prune()
    this.schedulePersist()
    return next
  }

  rename(key: string, name: string): SwarmSessionRecord | null {
    const prev = this.records.get(key)
    if (!prev) return null
    const cleaned = clean(name)
    if (!cleaned) return prev
    const next: SwarmSessionRecord = { ...prev, name: cleaned, updatedAt: Date.now() }
    this.records.set(key, next)
    this.schedulePersist()
    return next
  }

  dispose(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.persist()
  }

  private prune(): void {
    if (this.records.size <= MAX_RECORDS) return
    const ordered = [...this.records.values()].sort((a, b) => a.updatedAt - b.updatedAt)
    const drop = ordered.length - MAX_RECORDS
    for (let i = 0; i < drop; i++) this.records.delete(ordered[i]!.key)
  }

  private schedulePersist(): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persist()
    }, 200)
    this.persistTimer.unref?.()
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const body = JSON.stringify({
        version: FILE_VERSION,
        records: this.all()
      } satisfies SwarmHistoryFile)
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, body, 'utf8')
      renameSync(tmp, this.file)
    } catch (err) {
      console.error('[swarm-history] persist failed', err)
    }
  }
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, 120) : null
}

function blankTitleToNull(title: string | null): string | null {
  return isBlankSwarmSessionTitle(title) ? null : title
}

function sanitizeRecord(raw: unknown): SwarmSessionRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Partial<SwarmSessionRecord>
  if (!isStructuredCliHost(row.agentId) || !row.cursor || typeof row.cursor !== 'object') {
    return null
  }
  const sessionId = nativeSessionId(row.cursor)
  if (!sessionId) return null
  const createdAt = Number(row.createdAt)
  const updatedAt = Number(row.updatedAt)
  return {
    key: swarmSessionKey(row.agentId, sessionId),
    agentId: row.agentId,
    cursor: row.cursor,
    name: clean(row.name),
    title: blankTitleToNull(clean(row.title)),
    conversationId: typeof row.conversationId === 'string' ? row.conversationId : '',
    workingDirectory:
      typeof row.workingDirectory === 'string' && row.workingDirectory.trim()
        ? row.workingDirectory
        : '~',
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  }
}
