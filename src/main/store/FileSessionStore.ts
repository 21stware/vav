import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import type { Conversation, ThinkingLevel } from '@shared/types'
import { parseThinkingLevel } from '@shared/thinkingLevel'
import { isFileSessionEligible } from '@shared/clipPath'
import type { ConversationStore } from './ConversationStore'
import { defaultSessionTitle } from '@shared/i18n'
import { currentLocale } from '../i18n'

export interface FileSessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  tokensUsed: number
}

export interface FileSessionBundle {
  fileId: string
  /** "device:ino" when available from stat. */
  inodeKey: string | null
  path: string
  pathHash: string
  activeSessionId: string
  sessionIds: string[]
}

interface IndexFile {
  version: 1
  byId: Record<string, FileSessionBundle>
  byInode: Record<string, string>
  byPathHash: Record<string, string>
}

function pathHash(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 24)
}

/**
 * Extension → system-prompt playbook kind. Exported for AgentRuntime / tests.
 * null = ordinary text/code (use the generic open-file playbook).
 */
export function kindFromFilePath(path: string): string | null {
  const base = path.split(/[/\\]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return 'text'
  const ext = base.slice(dot).toLowerCase()
  if (ext === '.zip') return 'zip'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.csv' || ext === '.tsv') return 'csv'
  if (/\.(docx|xlsx|xls|pptx|ppt)$/i.test(ext)) return 'office'
  if (/\.(png|jpe?g|gif|webp|bmp|svg|heic|tif|tiff|avif)$/i.test(ext)) return 'image'
  if (/\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(ext)) return 'audio'
  if (/\.(mp4|mov|webm|mkv|avi)$/i.test(ext)) return 'video'
  if (/\.(db|sqlite|sqlite3|db3)$/i.test(ext)) return 'sqlite'
  if (ext === '.parquet') return 'parquet'
  const knownText =
    /\.(md|markdown|mdx|txt|json|js|ts|tsx|jsx|py|rs|go|swift|ipynb|html|css|xml|yml|yaml|toml|sh|zsh)$/i.test(
      ext
    )
  if (knownText) return null
  return 'binary'
}

/**
 * Per-file multi-session store for File Preview (file-preview.rpml FileSessionStore).
 *
 * Conversation bodies live in {@link ConversationStore} with `fileId` set so the
 * agent loop stays unchanged; this store owns the fileId → sessions index and
 * keeps them out of the main sidebar via ConversationStore.listMeta filtering.
 *
 * Ephemeral conversation overlays (temp clips under /vav-clips/) are not files
 * to chat about — they never enter this index.
 */
export class FileSessionStore {
  private readonly dir = join(app.getPath('userData'), 'file-sessions')
  private readonly indexPath = join(this.dir, 'index.json')
  private index: IndexFile = { version: 1, byId: {}, byInode: {}, byPathHash: {} }
  private conversations: ConversationStore | null = null

  bind(conversations: ConversationStore): void {
    this.conversations = conversations
    this.loadIndex()
    try {
      this.purgeStale()
    } catch {
      // best-effort
    }
    try {
      this.purgePreviewOnly()
    } catch {
      // best-effort
    }
  }

  private loadIndex(): void {
    try {
      mkdirSync(this.dir, { recursive: true })
      if (!existsSync(this.indexPath)) return
      const raw = JSON.parse(readFileSync(this.indexPath, 'utf8')) as IndexFile
      if (raw?.version === 1 && raw.byId) this.index = raw
    } catch (err) {
      console.error('[file-sessions] index load failed', err)
      this.index = { version: 1, byId: {}, byInode: {}, byPathHash: {} }
    }
  }

  private flushIndex(): void {
    try {
      mkdirSync(this.dir, { recursive: true })
      const tmp = `${this.indexPath}.tmp`
      writeFileSync(tmp, JSON.stringify(this.index, null, 2), 'utf8')
      renameSync(tmp, this.indexPath)
    } catch (err) {
      console.error('[file-sessions] index write failed', err)
    }
  }

  /** Absolute path for a fileId, if known. */
  pathForFileId(fileId: string): string | null {
    const bundle = this.index.byId[fileId]
    return bundle?.path ?? null
  }

  /** Path + live existence for the main shell file-session panel. */
  resolve(fileId: string): {
    path: string
    pathStatus: 'ok' | 'file_missing' | 'dir_missing'
  } | null {
    const path = this.pathForFileId(fileId)
    if (!path) return null
    return { path, pathStatus: pathExistence(path) }
  }

  /**
   * Coarse preview kind for system-prompt hints.
   * Derived from the stored path extension — no disk I/O.
   * Returns null for ordinary text/code (generic playbook).
   */
  kindForFileId(fileId: string): string | null {
    const path = this.pathForFileId(fileId)
    if (!path) return null
    return kindFromFilePath(path)
  }

  /** Resolve file identity: prefer inode+device, fall back to path hash. */
  async resolveIdentity(path: string): Promise<{
    fileId: string
    inodeKey: string | null
    pathHash: string
  }> {
    const hash = pathHash(path)
    let inodeKey: string | null = null
    try {
      const info = await stat(path)
      // Node provides ino + dev on all platforms we ship.
      inodeKey = `${info.dev}:${info.ino}`
    } catch {
      // path may not exist yet
    }

    if (inodeKey && this.index.byInode[inodeKey]) {
      const fileId = this.index.byInode[inodeKey]!
      return { fileId, inodeKey, pathHash: hash }
    }
    if (this.index.byPathHash[hash]) {
      const fileId = this.index.byPathHash[hash]!
      return { fileId, inodeKey, pathHash: hash }
    }

    // Prefer stable inode-based id when available.
    const fileId = inodeKey ? `ino-${createHash('sha256').update(inodeKey).digest('hex').slice(0, 20)}` : `path-${hash}`
    return { fileId, inodeKey, pathHash: hash }
  }

  private sessionMetas(sessionIds: string[]): FileSessionMeta[] {
    const conv = this.conversations
    if (!conv) return []
    const out: FileSessionMeta[] = []
    for (const id of sessionIds) {
      const c = conv.get(id)
      if (!c) continue
      out.push({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c.messages?.length ?? 0,
        tokensUsed: c.tokensUsed ?? 0
      })
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Open / restore the active session for a path. Creates a blank session if none.
   */
  async open(
    path: string,
    model: string,
    approvalMode: import('@shared/types').ApprovalMode = 'auto',
    thinkingLevel?: ThinkingLevel
  ): Promise<{
    fileId: string
    activeSessionId: string
    sessions: FileSessionMeta[]
    conversation: Conversation
  }> {
    if (!this.conversations) throw new Error('FileSessionStore not bound')
    if (!isFileSessionEligible(path)) throw new Error('preview_only')
    const identity = await this.resolveIdentity(path)
    let bundle = this.index.byId[identity.fileId]
    const level = parseThinkingLevel(thinkingLevel)

    if (!bundle) {
      const conversation = this.conversations.create(path ? dirnameSafe(path) : null, model, {
        fileId: identity.fileId,
        title: defaultSessionTitle(currentLocale()),
        approvalMode,
        thinkingLevel: level
      })
      // Title for empty file sessions
      this.conversations.updateMeta(conversation.id, {
        title: 'New session',
        fileId: identity.fileId
      })
      const created = this.conversations.get(conversation.id)!
      bundle = {
        fileId: identity.fileId,
        inodeKey: identity.inodeKey,
        path,
        pathHash: identity.pathHash,
        activeSessionId: created.id,
        sessionIds: [created.id]
      }
      this.index.byId[identity.fileId] = bundle
      if (identity.inodeKey) this.index.byInode[identity.inodeKey] = identity.fileId
      this.index.byPathHash[identity.pathHash] = identity.fileId
      this.flushIndex()
      return {
        fileId: identity.fileId,
        activeSessionId: created.id,
        sessions: this.sessionMetas(bundle.sessionIds),
        conversation: created
      }
    }

    // Refresh path / inode mapping when file moved or reappeared.
    bundle.path = path
    bundle.pathHash = identity.pathHash
    if (identity.inodeKey) {
      bundle.inodeKey = identity.inodeKey
      this.index.byInode[identity.inodeKey] = identity.fileId
    }
    this.index.byPathHash[identity.pathHash] = identity.fileId

    // Drop session ids that no longer exist in ConversationStore.
    bundle.sessionIds = bundle.sessionIds.filter((id) => !!this.conversations!.get(id))
    if (bundle.sessionIds.length === 0) {
      const conversation = this.conversations.create(dirnameSafe(path), model, {
        fileId: identity.fileId,
        title: 'New session',
        approvalMode,
        thinkingLevel: level
      })
      this.conversations.updateMeta(conversation.id, {
        title: 'New session',
        fileId: identity.fileId
      })
      bundle.sessionIds = [conversation.id]
      bundle.activeSessionId = conversation.id
    } else if (!bundle.sessionIds.includes(bundle.activeSessionId)) {
      bundle.activeSessionId = bundle.sessionIds[0]!
    }

    this.index.byId[identity.fileId] = bundle
    this.flushIndex()

    const conversation = this.conversations.get(bundle.activeSessionId)!
    return {
      fileId: identity.fileId,
      activeSessionId: conversation.id,
      sessions: this.sessionMetas(bundle.sessionIds),
      conversation
    }
  }

  async createSession(
    path: string,
    model: string,
    approvalMode: import('@shared/types').ApprovalMode = 'auto',
    thinkingLevel?: ThinkingLevel
  ): Promise<{
    fileId: string
    activeSessionId: string
    sessions: FileSessionMeta[]
    conversation: Conversation
  }> {
    if (!this.conversations) throw new Error('FileSessionStore not bound')
    if (!isFileSessionEligible(path)) throw new Error('preview_only')
    const opened = await this.open(path, model, approvalMode, thinkingLevel)
    const conversation = this.conversations.create(dirnameSafe(path), model, {
      fileId: opened.fileId,
      title: 'New session',
      approvalMode,
      thinkingLevel: parseThinkingLevel(thinkingLevel)
    })
    this.conversations.updateMeta(conversation.id, {
      title: 'New session',
      fileId: opened.fileId
    })
    const bundle = this.index.byId[opened.fileId]!
    bundle.sessionIds.unshift(conversation.id)
    bundle.activeSessionId = conversation.id
    this.flushIndex()
    const created = this.conversations.get(conversation.id)!
    return {
      fileId: opened.fileId,
      activeSessionId: created.id,
      sessions: this.sessionMetas(bundle.sessionIds),
      conversation: created
    }
  }

  setActive(fileId: string, sessionId: string): FileSessionMeta[] | null {
    const bundle = this.index.byId[fileId]
    if (!bundle || !bundle.sessionIds.includes(sessionId)) return null
    if (!this.conversations?.get(sessionId)) return null
    bundle.activeSessionId = sessionId
    this.flushIndex()
    return this.sessionMetas(bundle.sessionIds)
  }

  list(fileId: string): { activeSessionId: string; sessions: FileSessionMeta[] } | null {
    const bundle = this.index.byId[fileId]
    if (!bundle) return null
    return {
      activeSessionId: bundle.activeSessionId,
      sessions: this.sessionMetas(bundle.sessionIds)
    }
  }

  /**
   * Every file-bound session across all bundles (sidebar “Show file sessions”).
   * Path status is checked live; missing files/dirs are still listed.
   */
  listAll(): {
    fileId: string
    path: string
    pathStatus: 'ok' | 'file_missing' | 'dir_missing'
    sessionId: string
    title: string
    createdAt: number
    updatedAt: number
    messageCount: number
    tokensUsed: number
    isActive: boolean
  }[] {
    if (!this.conversations) return []
    const out: {
      fileId: string
      path: string
      pathStatus: 'ok' | 'file_missing' | 'dir_missing'
      sessionId: string
      title: string
      createdAt: number
      updatedAt: number
      messageCount: number
      tokensUsed: number
      isActive: boolean
    }[] = []
    for (const bundle of Object.values(this.index.byId)) {
      if (!isFileSessionEligible(bundle.path)) continue
      const pathStatus = pathExistence(bundle.path)
      for (const sessionId of bundle.sessionIds) {
        const c = this.conversations.get(sessionId)
        if (!c) continue
        out.push({
          fileId: bundle.fileId,
          path: bundle.path,
          pathStatus,
          sessionId: c.id,
          title: c.title || 'New session',
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          messageCount: c.messages?.length ?? 0,
          tokensUsed: c.tokensUsed ?? 0,
          isActive: bundle.activeSessionId === c.id
        })
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Sidebar force-delete: no active/last protection. Empty fileId bundles are dropped.
   */
  forceDelete(
    fileId: string,
    sessionIds: string[]
  ): {
    ok: boolean
    error?: string
    removed: string[]
  } {
    const bundle = this.index.byId[fileId]
    if (!bundle || !this.conversations) {
      return { ok: false, error: 'no_match', removed: [] }
    }
    const wanted = [...new Set(sessionIds)].filter((id) => bundle.sessionIds.includes(id))
    if (wanted.length === 0) {
      return { ok: false, error: 'no_match', removed: [] }
    }
    const remainingIds = bundle.sessionIds.filter((id) => !wanted.includes(id))
    const removed = this.conversations.remove(wanted)
    const stillPresent = wanted.filter((id) => !!this.conversations!.get(id))
    if (stillPresent.length > 0) {
      return { ok: false, error: 'disk_write_failed', removed: [] }
    }
    if (remainingIds.length === 0) {
      delete this.index.byId[fileId]
      if (bundle.inodeKey) delete this.index.byInode[bundle.inodeKey]
      delete this.index.byPathHash[bundle.pathHash]
    } else {
      bundle.sessionIds = remainingIds
      if (!bundle.sessionIds.includes(bundle.activeSessionId)) {
        bundle.activeSessionId = bundle.sessionIds[0]!
      }
      this.index.byId[fileId] = bundle
    }
    this.flushIndex()
    try {
      this.conversations.flush()
    } catch {
      // index already updated; conversations may recover on next load
    }
    return { ok: true, removed: removed.length ? removed : wanted }
  }

  /**
   * Rename a file-preview session title (≤100 chars, non-empty).
   * Same name as another session is allowed.
   */
  rename(fileId: string, sessionId: string, title: string): FileSessionMeta[] | null {
    const bundle = this.index.byId[fileId]
    if (!bundle || !bundle.sessionIds.includes(sessionId)) return null
    if (!this.conversations?.get(sessionId)) return null
    const next = title.trim().slice(0, 100)
    if (!next) return null
    this.conversations.updateMeta(sessionId, { title: next })
    return this.sessionMetas(bundle.sessionIds)
  }

  /**
   * Delete one or more sessions for a file. Active and last-remaining sessions
   * are protected (file-preview.rpml History → 删除约束).
   */
  deleteSessions(
    fileId: string,
    sessionIds: string[]
  ): {
    ok: boolean
    error?: string
    activeSessionId: string
    sessions: FileSessionMeta[]
    removed: string[]
  } | null {
    const bundle = this.index.byId[fileId]
    if (!bundle || !this.conversations) return null

    const wanted = [...new Set(sessionIds)].filter((id) => bundle.sessionIds.includes(id))
    if (wanted.length === 0) {
      return {
        ok: false,
        error: 'no_match',
        activeSessionId: bundle.activeSessionId,
        sessions: this.sessionMetas(bundle.sessionIds),
        removed: []
      }
    }

    // Never delete the active session.
    if (wanted.includes(bundle.activeSessionId)) {
      return {
        ok: false,
        error: 'active_protected',
        activeSessionId: bundle.activeSessionId,
        sessions: this.sessionMetas(bundle.sessionIds),
        removed: []
      }
    }

    // Never delete the last remaining session.
    const remainingIds = bundle.sessionIds.filter((id) => !wanted.includes(id))
    if (remainingIds.length === 0) {
      return {
        ok: false,
        error: 'last_protected',
        activeSessionId: bundle.activeSessionId,
        sessions: this.sessionMetas(bundle.sessionIds),
        removed: []
      }
    }

    // Snapshot for rollback if the conversation write fails mid-delete.
    const prevSessionIds = [...bundle.sessionIds]
    const prevActive = bundle.activeSessionId

    bundle.sessionIds = remainingIds
    if (!bundle.sessionIds.includes(bundle.activeSessionId)) {
      bundle.activeSessionId = bundle.sessionIds[0]!
    }
    // Mark first, then persist conversation bodies (spec: 先标记再写盘).
    this.flushIndex()

    const removed = this.conversations.remove(wanted)
    const stillPresent = wanted.filter((id) => !!this.conversations!.get(id))
    if (stillPresent.length > 0) {
      // Write failed / guard fired — roll back index so sessions reappear.
      bundle.sessionIds = prevSessionIds
      bundle.activeSessionId = prevActive
      this.flushIndex()
      return {
        ok: false,
        error: 'disk_write_failed',
        activeSessionId: bundle.activeSessionId,
        sessions: this.sessionMetas(bundle.sessionIds),
        removed: []
      }
    }

    try {
      this.conversations.flush()
    } catch {
      bundle.sessionIds = prevSessionIds
      bundle.activeSessionId = prevActive
      this.flushIndex()
      return {
        ok: false,
        error: 'disk_write_failed',
        activeSessionId: bundle.activeSessionId,
        sessions: this.sessionMetas(bundle.sessionIds),
        removed: []
      }
    }
    return {
      ok: true,
      activeSessionId: bundle.activeSessionId,
      sessions: this.sessionMetas(bundle.sessionIds),
      removed: removed.length ? removed : wanted
    }
  }

  /**
   * Drop orphan fileId bundles with no access for 30+ days (best-effort GC).
   * Called on bind / open; never blocks UI.
   */
  purgeStale(maxAgeMs = 30 * 24 * 60 * 60 * 1000): void {
    if (!this.conversations) return
    const now = Date.now()
    let changed = false
    for (const [fileId, bundle] of Object.entries(this.index.byId)) {
      const metas = this.sessionMetas(bundle.sessionIds)
      const latest = metas.reduce((m, s) => Math.max(m, s.updatedAt), 0)
      if (latest > 0 && now - latest > maxAgeMs) {
        // Only purge empty or fully stale bundles with zero live conversations.
        const live = bundle.sessionIds.filter((id) => !!this.conversations!.get(id))
        if (live.length === 0) {
          delete this.index.byId[fileId]
          if (bundle.inodeKey) delete this.index.byInode[bundle.inodeKey]
          delete this.index.byPathHash[bundle.pathHash]
          changed = true
        }
      }
    }
    if (changed) this.flushIndex()
  }

  /**
   * Conversation overlays write temp clips under /vav-clips/. Those are
   * preview windows, not files to chat about — drop leftover bundles.
   */
  private purgePreviewOnly(): void {
    if (!this.conversations) return
    let changed = false
    for (const [fileId, bundle] of Object.entries(this.index.byId)) {
      if (isFileSessionEligible(bundle.path)) continue
      if (bundle.sessionIds.length > 0) {
        this.conversations.remove(bundle.sessionIds)
      }
      delete this.index.byId[fileId]
      if (bundle.inodeKey) delete this.index.byInode[bundle.inodeKey]
      delete this.index.byPathHash[bundle.pathHash]
      changed = true
    }
    if (!changed) return
    this.flushIndex()
    try {
      this.conversations.flush()
    } catch {
      // index already updated
    }
  }
}

function dirnameSafe(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i > 0 ? path.slice(0, i) : path
}

function pathExistence(path: string): 'ok' | 'file_missing' | 'dir_missing' {
  if (!path) return 'file_missing'
  try {
    const dir = dirnameSafe(path)
    if (dir && dir !== path && !existsSync(dir)) return 'dir_missing'
    if (!existsSync(path)) return 'file_missing'
    // If path exists but is a directory, treat as missing file for preview.
    try {
      if (statSync(path).isDirectory()) return 'file_missing'
    } catch {
      return 'file_missing'
    }
    return 'ok'
  } catch {
    return 'file_missing'
  }
}
