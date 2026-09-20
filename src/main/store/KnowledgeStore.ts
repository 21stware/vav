import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  knowledgeTitleFromPath,
  type KnowledgeHost,
  type KnowledgeHostKind,
  type KnowledgeNote
} from '../../shared/knowledge.ts'
import type { DocumentRetrievalService } from '../retrieval/DocumentRetrievalService.ts'

function coerceHost(raw: unknown): KnowledgeHost | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id.trim()) return null
  const kind: KnowledgeHostKind = row.kind === 'note' ? 'note' : 'document'
  const createdAt = typeof row.createdAt === 'number' ? row.createdAt : Date.now()
  return {
    id: row.id,
    title: typeof row.title === 'string' ? row.title : '',
    kind,
    sourcePath: typeof row.sourcePath === 'string' && row.sourcePath.trim() ? row.sourcePath : null,
    storedPath: typeof row.storedPath === 'string' && row.storedPath.trim() ? row.storedPath : null,
    conversationId:
      typeof row.conversationId === 'string' && row.conversationId.trim()
        ? row.conversationId
        : null,
    chunkCount: typeof row.chunkCount === 'number' ? row.chunkCount : 0,
    createdAt,
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : createdAt
  }
}

export class KnowledgeStore {
  private readonly dir: string
  private readonly indexPath: string
  private readonly notesDir: string
  private readonly docsDir: string
  private hosts: KnowledgeHost[] = []

  constructor(stateDir: string) {
    this.dir = join(stateDir, 'knowledge')
    this.indexPath = join(this.dir, 'index.json')
    this.notesDir = join(this.dir, 'notes')
    this.docsDir = join(this.dir, 'docs')
  }

  load(): void {
    this.ensureDirs()
    this.hosts = this.readList()
  }

  list(): KnowledgeHost[] {
    return this.hosts.map((row) => ({ ...row }))
  }

  get(id: string): KnowledgeHost | undefined {
    const row = this.hosts.find((item) => item.id === id)
    return row ? { ...row } : undefined
  }

  getForConversation(conversationId: string): KnowledgeHost | undefined {
    const id = conversationId.trim()
    if (!id) return undefined
    const row = this.hosts.find((item) => item.conversationId === id)
    return row ? { ...row } : undefined
  }

  createNote(title: string, conversationId: string | null, now = Date.now()): KnowledgeHost {
    this.ensureDirs()
    const id = randomUUID()
    const storedPath = join(this.notesDir, `${id}.md`)
    const heading = title.trim() || 'Untitled note'
    writeFileSync(storedPath, `# ${heading}\n\n`, 'utf8')
    const host: KnowledgeHost = {
      id,
      title: heading,
      kind: 'note',
      sourcePath: null,
      storedPath,
      conversationId: conversationId?.trim() || null,
      chunkCount: 0,
      createdAt: now,
      updatedAt: now
    }
    this.hosts.unshift(host)
    this.persist()
    return { ...host }
  }

  importDocument(
    sourcePath: string,
    conversationId: string | null,
    retrieval: DocumentRetrievalService | null,
    now = Date.now()
  ): KnowledgeHost {
    this.ensureDirs()
    const id = randomUUID()
    const ext = extname(sourcePath) || '.bin'
    const storedPath = join(this.docsDir, `${id}${ext}`)
    copyFileSync(sourcePath, storedPath)
    const title = knowledgeTitleFromPath(sourcePath)
    const host: KnowledgeHost = {
      id,
      title,
      kind: 'document',
      sourcePath,
      storedPath,
      conversationId: conversationId?.trim() || null,
      chunkCount: 0,
      createdAt: now,
      updatedAt: now
    }
    this.hosts.unshift(host)
    this.persist()
    if (retrieval) void this.refreshChunks(id, retrieval)
    return { ...host }
  }

  async refreshChunks(id: string, retrieval: DocumentRetrievalService): Promise<KnowledgeHost | null> {
    const row = this.hosts.find((item) => item.id === id)
    if (!row?.storedPath) return row ? { ...row } : null
    try {
      const meta = await retrieval.ensureIndex(row.storedPath)
      row.chunkCount = meta.chunkCount
      row.updatedAt = Date.now()
      this.persist()
    } catch {
      // Indexing can fail on empty/scanned PDFs — keep the host.
    }
    return { ...row }
  }

  readNote(id: string): KnowledgeNote | null {
    const row = this.hosts.find((item) => item.id === id)
    if (!row || row.kind !== 'note' || !row.storedPath || !existsSync(row.storedPath)) return null
    return {
      hostId: row.id,
      markdown: readFileSync(row.storedPath, 'utf8'),
      updatedAt: row.updatedAt
    }
  }

  writeNote(id: string, markdown: string, now = Date.now()): KnowledgeNote | null {
    const row = this.hosts.find((item) => item.id === id)
    if (!row || row.kind !== 'note' || !row.storedPath) return null
    this.ensureDirs()
    writeFileSync(row.storedPath, markdown, 'utf8')
    const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
    if (heading) row.title = heading
    row.updatedAt = now
    this.persist()
    return { hostId: row.id, markdown, updatedAt: now }
  }

  rename(id: string, title: string, now = Date.now()): KnowledgeHost | null {
    const row = this.hosts.find((item) => item.id === id)
    if (!row) return null
    row.title = title.trim() || row.title
    row.updatedAt = now
    this.persist()
    return { ...row }
  }

  bindConversation(id: string, conversationId: string | null): KnowledgeHost | null {
    const row = this.hosts.find((item) => item.id === id)
    if (!row) return null
    row.conversationId = conversationId?.trim() || null
    row.updatedAt = Date.now()
    this.persist()
    return { ...row }
  }

  remove(id: string): boolean {
    const row = this.hosts.find((item) => item.id === id)
    if (!row) return false
    this.hosts = this.hosts.filter((item) => item.id !== id)
    if (row.storedPath && existsSync(row.storedPath)) {
      try {
        unlinkSync(row.storedPath)
      } catch {
        // ignore
      }
    }
    this.persist()
    return true
  }

  searchTargets(): Array<{ id: string; title: string; path: string; kind: KnowledgeHostKind }> {
    return this.hosts
      .filter((row) => row.storedPath)
      .map((row) => ({
        id: row.id,
        title: row.title,
        path: row.storedPath!,
        kind: row.kind
      }))
  }

  private ensureDirs(): void {
    mkdirSync(this.notesDir, { recursive: true })
    mkdirSync(this.docsDir, { recursive: true })
  }

  private readList(): KnowledgeHost[] {
    if (!existsSync(this.indexPath)) return []
    try {
      const raw = JSON.parse(readFileSync(this.indexPath, 'utf8')) as unknown
      if (!Array.isArray(raw)) return []
      return raw.map(coerceHost).filter((row): row is KnowledgeHost => row !== null)
    } catch {
      return []
    }
  }

  private persist(): void {
    this.ensureDirs()
    writeFileSync(this.indexPath, `${JSON.stringify(this.hosts, null, 2)}\n`, 'utf8')
  }
}

export function knowledgeVaultNoteName(path: string): string {
  return basename(path)
}
