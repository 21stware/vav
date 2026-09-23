import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  KNOWLEDGE_ALL_NOTES_ID,
  knowledgeTitleFromPath,
  noteMarkdownWithTitle,
  type KnowledgeFolder,
  type KnowledgeHost,
  type KnowledgeHostKind,
  type KnowledgeNote
} from '../../shared/knowledge.ts'
import type { DocumentRetrievalService } from '../retrieval/DocumentRetrievalService.ts'

function coerceFolder(raw: unknown): KnowledgeFolder | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id.trim() || row.id === KNOWLEDGE_ALL_NOTES_ID) return null
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  if (!name) return null
  const createdAt = typeof row.createdAt === 'number' ? row.createdAt : Date.now()
  return {
    id: row.id,
    name,
    createdAt,
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : createdAt
  }
}

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
    folderId:
      typeof row.folderId === 'string' &&
      row.folderId.trim() &&
      row.folderId !== KNOWLEDGE_ALL_NOTES_ID
        ? row.folderId
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
  private readonly migrateFrom: string | null
  private hosts: KnowledgeHost[] = []
  private folders: KnowledgeFolder[] = []

  constructor(stateDir: string, options?: { migrateFrom?: string | null }) {
    this.dir = join(stateDir, 'knowledge')
    this.indexPath = join(this.dir, 'index.json')
    this.notesDir = join(this.dir, 'notes')
    this.docsDir = join(this.dir, 'docs')
    this.migrateFrom = options?.migrateFrom?.trim() || null
  }

  /** Vault directory (`…/knowledge`) — grant this so FileService can read notes. */
  get rootDir(): string {
    return this.dir
  }

  load(): void {
    this.migrateFromUserData()
    this.refresh()
  }

  listFolders(): KnowledgeFolder[] {
    this.refresh()
    return this.folders.map((row) => ({ ...row }))
  }

  getFolder(id: string): KnowledgeFolder | undefined {
    this.refresh()
    const row = this.folders.find((item) => item.id === id)
    return row ? { ...row } : undefined
  }

  createFolder(name: string, now = Date.now()): KnowledgeFolder {
    this.refresh()
    const folder: KnowledgeFolder = {
      id: randomUUID(),
      name: name.trim() || 'Untitled folder',
      createdAt: now,
      updatedAt: now
    }
    this.folders.push(folder)
    this.persist()
    return { ...folder }
  }

  renameFolder(id: string, name: string, now = Date.now()): KnowledgeFolder | null {
    this.refresh()
    if (!id || id === KNOWLEDGE_ALL_NOTES_ID) return null
    const row = this.folders.find((item) => item.id === id)
    if (!row) return null
    const next = name.trim()
    if (!next) return { ...row }
    row.name = next
    row.updatedAt = now
    this.persist()
    return { ...row }
  }

  /**
   * Removes a user folder. Notes inside it stay in the library (unfiled)
   * and remain visible under All Notes. All Notes itself cannot be removed.
   */
  removeFolder(id: string): boolean {
    this.refresh()
    if (!id || id === KNOWLEDGE_ALL_NOTES_ID) return false
    if (!this.folders.some((item) => item.id === id)) return false
    this.folders = this.folders.filter((item) => item.id !== id)
    for (const host of this.hosts) {
      if (host.folderId === id) host.folderId = null
    }
    this.persist()
    return true
  }

  /** `folderId` null or `all` unfiles the hosts. Unknown folders are refused. */
  moveToFolder(ids: string[], folderId: string | null, now = Date.now()): KnowledgeHost[] | null {
    this.refresh()
    const target = this.resolveFolderId(folderId)
    if (target === undefined) return null
    const wanted = new Set(ids.map((id) => id.trim()).filter(Boolean))
    const moved: KnowledgeHost[] = []
    for (const host of this.hosts) {
      if (!wanted.has(host.id) || host.folderId === target) continue
      host.folderId = target
      host.updatedAt = now
      moved.push({ ...host })
    }
    if (moved.length) this.persist()
    return moved
  }

  list(): KnowledgeHost[] {
    this.refresh()
    return this.hosts.map((row) => ({ ...row }))
  }

  get(id: string): KnowledgeHost | undefined {
    this.refresh()
    const row = this.hosts.find((item) => item.id === id)
    return row ? { ...row } : undefined
  }

  getForConversation(conversationId: string): KnowledgeHost | undefined {
    this.refresh()
    const id = conversationId.trim()
    if (!id) return undefined
    const row = this.hosts.find((item) => item.conversationId === id)
    return row ? { ...row } : undefined
  }

  createNote(
    title: string,
    conversationId: string | null,
    now = Date.now(),
    folderId: string | null = null
  ): KnowledgeHost {
    this.refresh()
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
      folderId: this.resolveFolderId(folderId) ?? null,
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
    now = Date.now(),
    folderId: string | null = null
  ): KnowledgeHost {
    this.refresh()
    this.ensureDirs()
    const id = randomUUID()
    const ext = extname(sourcePath) || '.bin'
    const storedPath = join(this.docsDir, `${id}${ext}`)
    cpSync(sourcePath, storedPath)
    const title = knowledgeTitleFromPath(sourcePath)
    const host: KnowledgeHost = {
      id,
      title,
      kind: 'document',
      sourcePath,
      storedPath,
      conversationId: conversationId?.trim() || null,
      folderId: this.resolveFolderId(folderId) ?? null,
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
    this.refresh()
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
    this.refresh()
    const row = this.hosts.find((item) => item.id === id)
    if (!row || row.kind !== 'note' || !row.storedPath || !existsSync(row.storedPath)) return null
    return {
      hostId: row.id,
      markdown: readFileSync(row.storedPath, 'utf8'),
      updatedAt: row.updatedAt
    }
  }

  writeNote(id: string, markdown: string, now = Date.now()): KnowledgeNote | null {
    this.refresh()
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
    this.refresh()
    const row = this.hosts.find((item) => item.id === id)
    if (!row) return null
    const next = title.trim()
    if (!next) return { ...row }
    row.title = next
    if (row.kind === 'note' && row.storedPath) {
      this.ensureDirs()
      const markdown = existsSync(row.storedPath) ? readFileSync(row.storedPath, 'utf8') : ''
      const updated = noteMarkdownWithTitle(markdown, next)
      if (updated !== markdown) writeFileSync(row.storedPath, updated, 'utf8')
    }
    row.updatedAt = now
    this.persist()
    return { ...row }
  }

  bindConversation(id: string, conversationId: string | null): KnowledgeHost | null {
    this.refresh()
    const row = this.hosts.find((item) => item.id === id)
    if (!row) return null
    row.conversationId = conversationId?.trim() || null
    row.updatedAt = Date.now()
    this.persist()
    return { ...row }
  }

  remove(id: string): boolean {
    this.refresh()
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

  searchTargets(): Array<{
    id: string
    title: string
    path: string
    kind: KnowledgeHostKind
    folderId: string | null
    folderName: string | null
  }> {
    this.refresh()
    return this.hosts
      .filter((row) => row.storedPath)
      .map((row) => ({
        id: row.id,
        title: row.title,
        path: row.storedPath!,
        kind: row.kind,
        folderId: row.folderId,
        folderName: row.folderId ? (this.getFolder(row.folderId)?.name ?? null) : null
      }))
  }

  /** null = unfiled. undefined = the id is not a real folder. */
  private resolveFolderId(folderId: string | null | undefined): string | null | undefined {
    const id = folderId?.trim() || ''
    if (!id || id === KNOWLEDGE_ALL_NOTES_ID) return null
    return this.folders.some((folder) => folder.id === id) ? id : undefined
  }

  /** Re-read index.json so desktop and the spawned local vav-server stay in sync. */
  private refresh(): void {
    this.ensureDirs()
    const index = this.readIndex()
    this.hosts = index.hosts
    this.folders = index.folders
    this.dropMissingFolders()
  }

  private migrateFromUserData(): void {
    if (!this.migrateFrom || existsSync(this.indexPath)) return
    const legacyDir = join(this.migrateFrom, 'knowledge')
    const legacyIndex = join(legacyDir, 'index.json')
    if (!existsSync(legacyIndex)) return
    try {
      mkdirSync(this.dir, { recursive: true })
      cpSync(legacyDir, this.dir, { recursive: true })
      const index = this.readIndex()
      let rewritten = false
      for (const host of index.hosts) {
        if (!host.storedPath?.startsWith(legacyDir)) continue
        host.storedPath = join(this.dir, relative(legacyDir, host.storedPath))
        rewritten = true
      }
      this.hosts = index.hosts
      this.folders = index.folders
      if (rewritten) this.persist()
    } catch (err) {
      console.error('[knowledge] migrate from userData failed', err)
    }
  }

  private dropMissingFolders(): void {
    const ids = new Set(this.folders.map((folder) => folder.id))
    let changed = false
    for (const host of this.hosts) {
      if (host.folderId && !ids.has(host.folderId)) {
        host.folderId = null
        changed = true
      }
    }
    if (changed) this.persist()
  }

  private ensureDirs(): void {
    mkdirSync(this.notesDir, { recursive: true })
    mkdirSync(this.docsDir, { recursive: true })
  }

  private readIndex(): { hosts: KnowledgeHost[]; folders: KnowledgeFolder[] } {
    if (!existsSync(this.indexPath)) return { hosts: [], folders: [] }
    try {
      const raw = JSON.parse(readFileSync(this.indexPath, 'utf8')) as unknown
      if (Array.isArray(raw)) {
        return {
          hosts: raw.map(coerceHost).filter((row): row is KnowledgeHost => row !== null),
          folders: []
        }
      }
      if (!raw || typeof raw !== 'object') return { hosts: [], folders: [] }
      const record = raw as Record<string, unknown>
      const hosts = Array.isArray(record.hosts) ? record.hosts : []
      const folders = Array.isArray(record.folders) ? record.folders : []
      return {
        hosts: hosts.map(coerceHost).filter((row): row is KnowledgeHost => row !== null),
        folders: folders.map(coerceFolder).filter((row): row is KnowledgeFolder => row !== null)
      }
    } catch {
      return { hosts: [], folders: [] }
    }
  }

  private persist(): void {
    this.ensureDirs()
    const body = {
      hosts: this.hosts,
      folders: this.folders
    }
    writeFileSync(this.indexPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  }
}

export function knowledgeVaultNoteName(path: string): string {
  return basename(path)
}
