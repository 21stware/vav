import { randomUUID } from 'node:crypto'
import { relative, dirname, join, extname } from 'node:path'
import { writeFile, unlink, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import {
  computeRisk,
  isLikelyBinaryPath,
  summarizeChangeSetStatus,
  type ChangeContentEncoding,
  type ChangeEntry,
  type ChangeSet,
  type ChangeType
} from '@shared/changeSet'
import { unifiedDiff } from './diff'

interface PendingWrite {
  filePath: string
  relativePath: string
  changeType: ChangeType
  diffText: string
  originalContent: string | null
  newContent: string
  contentEncoding: ChangeContentEncoding
}

interface BaselineFile {
  size: number
  mtimeMs: number
  /** utf8 text or base64 bytes; null when too large to snapshot for Reject. */
  content: string | null
  encoding: ChangeContentEncoding
}

const IGNORE_NAMES = new Set([
  '.git',
  'node_modules',
  '.DS_Store',
  'dist',
  'build',
  'out',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  '.turbo',
  'coverage'
])

/** Per-file soft cap for baseline / after snapshots (Reject needs a copy). */
const SNAPSHOT_MAX_BYTES = 12 * 1024 * 1024
const WALK_MAX_FILES = 2_500
const WALK_MAX_DEPTH = 8

/**
 * Accumulates file writes for one agent turn, then freezes them into a
 * ChangeSet the renderer can Accept / Reject.
 *
 * Sources:
 * - `fs_write` (text) via {@link recordWrite}
 * - workdir snapshot diff at finalize (officecli / shell / skills writing
 *   .docx/.pdf/etc. that never go through fs_write)
 *
 * Writes already landed on disk during the turn — Accept keeps them, Reject
 * restores `originalContent` (or deletes a newly added file).
 */
export class ChangeSetStore {
  private pending = new Map<string, PendingWrite[]>()
  private sets = new Map<string, ChangeSet>()
  /** conversationId → active review set id (latest unresolved). */
  private activeByConversation = new Map<string, string>()
  /** Workdir file baselines captured at turn start. */
  private baselines = new Map<string, Map<string, BaselineFile>>()
  private workdirs = new Map<string, string>()
  private baselineReady = new Map<string, Promise<void>>()

  beginTurn(conversationId: string, workdir: string): void {
    this.pending.set(conversationId, [])
    this.workdirs.set(conversationId, workdir)
    // Prior review sets are superseded by the new turn — drop them so a late
    // get() cannot revive a dead card as "Could not load changes".
    const active = this.activeByConversation.get(conversationId)
    if (active) {
      this.sets.delete(active)
      this.activeByConversation.delete(conversationId)
    }
    for (const [id, set] of [...this.sets.entries()]) {
      if (set.conversationId === conversationId) this.sets.delete(id)
    }
    const snap = captureBaseline(workdir)
    this.baselineReady.set(conversationId, snap.then((map) => {
      this.baselines.set(conversationId, map)
    }))
  }

  recordWrite(
    conversationId: string,
    workdir: string,
    filePath: string,
    originalContent: string | null,
    newContent: string
  ): void {
    this.upsertPending(conversationId, workdir, {
      filePath,
      changeType: originalContent === null ? 'added' : 'modified',
      originalContent,
      newContent,
      contentEncoding: 'utf8'
    })
  }

  /**
   * Freeze pending writes + workdir snapshot diffs into a ChangeSet.
   * Returns null when nothing to review (or the turn was cancelled / errored).
   */
  async finalizeTurn(
    conversationId: string,
    turnTitle: string,
    model: string,
    opts?: { cancelled?: boolean; error?: boolean }
  ): Promise<ChangeSet | null> {
    try {
      await this.baselineReady.get(conversationId)
    } catch {
      // Snapshot failed — still finalize fs_write entries.
    }
    const workdir = this.workdirs.get(conversationId)
    if (workdir && !opts?.cancelled && !opts?.error) {
      await this.collectExternalChanges(conversationId, workdir)
    }

    const list = this.pending.get(conversationId) ?? []
    this.pending.delete(conversationId)
    this.baselines.delete(conversationId)
    this.baselineReady.delete(conversationId)
    this.workdirs.delete(conversationId)

    if (opts?.cancelled || opts?.error || list.length === 0) return null

    const files: ChangeEntry[] = list.map((e) => ({
      filePath: e.filePath,
      relativePath: e.relativePath,
      changeType: e.changeType,
      diffText: e.diffText,
      originalContent: e.originalContent,
      newContent: e.newContent,
      contentEncoding: e.contentEncoding,
      status: 'pending',
      riskLevel: 'low'
    }))
    const risk = computeRisk(files)
    for (const f of files) f.riskLevel = risk

    const set: ChangeSet = {
      id: randomUUID(),
      conversationId,
      turnTitle: turnTitle.slice(0, 60),
      model,
      files,
      risk,
      status: 'pending',
      createdAt: Date.now()
    }
    this.sets.set(set.id, set)
    this.activeByConversation.set(conversationId, set.id)
    return set
  }

  get(id: string): ChangeSet | null {
    return this.sets.get(id) ?? null
  }

  activeFor(conversationId: string): ChangeSet | null {
    const id = this.activeByConversation.get(conversationId)
    return id ? (this.sets.get(id) ?? null) : null
  }

  pendingCount(conversationId: string): number {
    const set = this.activeFor(conversationId)
    if (!set) return 0
    return set.files.filter((f) => f.status === 'pending').length
  }

  async accept(setId: string, filePaths: string[]): Promise<ChangeSet | null> {
    const set = this.sets.get(setId)
    if (!set) return null
    for (const file of set.files) {
      if (!filePaths.includes(file.filePath)) continue
      if (file.status !== 'pending' && file.status !== 'edited') continue
      // Already on disk from the agent write.
      file.status = 'accepted'
    }
    set.status = summarizeChangeSetStatus(set.files)
    this.pruneActive(set)
    return set
  }

  async reject(setId: string, filePaths: string[]): Promise<ChangeSet | null> {
    const set = this.sets.get(setId)
    if (!set) return null
    for (const file of set.files) {
      if (!filePaths.includes(file.filePath)) continue
      await restoreFile(file)
      file.status = 'rejected'
    }
    set.status = summarizeChangeSetStatus(set.files)
    this.pruneActive(set)
    return set
  }

  async acceptAll(setId: string): Promise<ChangeSet | null> {
    const set = this.sets.get(setId)
    if (!set) return null
    const pending = set.files.filter((f) => f.status === 'pending').map((f) => f.filePath)
    return this.accept(setId, pending)
  }

  async rejectAll(setId: string): Promise<ChangeSet | null> {
    const set = this.sets.get(setId)
    if (!set) return null
    // Spec: Reject All rolls back everything including already-accepted.
    const paths = set.files.filter((f) => f.status !== 'rejected').map((f) => f.filePath)
    return this.reject(setId, paths)
  }

  /** Re-apply agent content after Reject, or roll back after Accept → pending. */
  async undo(setId: string, filePath: string): Promise<ChangeSet | null> {
    const set = this.sets.get(setId)
    if (!set) return null
    const file = set.files.find((f) => f.filePath === filePath)
    if (!file || file.status === 'pending') return set

    if (file.status === 'accepted' || file.status === 'edited') {
      await restoreFile(file)
      file.status = 'pending'
    } else if (file.status === 'rejected') {
      await writeEntryContent(file.filePath, file.newContent, file.contentEncoding ?? 'utf8')
      file.status = 'pending'
    }
    set.status = summarizeChangeSetStatus(set.files)
    this.activeByConversation.set(set.conversationId, set.id)
    return set
  }

  async applyEdit(setId: string, filePath: string, content: string): Promise<ChangeSet | null> {
    const set = this.sets.get(setId)
    if (!set) return null
    const file = set.files.find((f) => f.filePath === filePath)
    if (!file) return null
    if ((file.contentEncoding ?? 'utf8') === 'base64' || isLikelyBinaryPath(file.filePath)) {
      return set // binary / raw — no in-review text edit
    }
    await mkdir(dirname(file.filePath), { recursive: true })
    await writeFile(file.filePath, content, 'utf8')
    file.newContent = content
    file.contentEncoding = 'utf8'
    file.diffText =
      unifiedDiff(file.originalContent, content) ??
      (file.changeType === 'added' ? `+${content.split('\n').length} lines` : '(edited)')
    file.status = 'edited'
    set.status = summarizeChangeSetStatus(set.files)
    this.pruneActive(set)
    return set
  }

  private upsertPending(
    conversationId: string,
    workdir: string,
    input: {
      filePath: string
      changeType: ChangeType
      originalContent: string | null
      newContent: string
      contentEncoding: ChangeContentEncoding
    }
  ): void {
    const list = this.pending.get(conversationId) ?? []
    this.pending.set(conversationId, list)
    const relativePath = toRelative(workdir, input.filePath)
    const diffText = summarizeDiff({ ...input, filePath: input.filePath })
    const entry: PendingWrite = {
      filePath: input.filePath,
      relativePath,
      changeType: input.changeType,
      diffText,
      originalContent: input.originalContent,
      newContent: input.newContent,
      contentEncoding: input.contentEncoding
    }
    const existing = list.findIndex((e) => e.filePath === input.filePath)
    if (existing >= 0) list[existing] = entry
    else list.push(entry)
  }

  private async collectExternalChanges(conversationId: string, workdir: string): Promise<void> {
    const baseline = this.baselines.get(conversationId) ?? new Map<string, BaselineFile>()
    const current = await walkFileMeta(workdir)
    const pending = this.pending.get(conversationId) ?? []
    const already = new Set(pending.map((p) => p.filePath))

    // Added or modified
    for (const [filePath, meta] of current) {
      if (already.has(filePath)) continue
      const before = baseline.get(filePath)
      if (before && before.size === meta.size && before.mtimeMs === meta.mtimeMs) continue

      const after = await readSnapshot(filePath)
      if (!after) continue

      if (!before) {
        this.upsertPending(conversationId, workdir, {
          filePath,
          changeType: 'added',
          originalContent: null,
          newContent: after.content ?? '',
          contentEncoding: after.encoding
        })
        continue
      }

      // Same content despite mtime bump — skip.
      if (
        before.content != null &&
        after.content != null &&
        before.content === after.content &&
        before.encoding === after.encoding
      ) {
        continue
      }

      this.upsertPending(conversationId, workdir, {
        filePath,
        changeType: 'modified',
        originalContent: before.content,
        newContent: after.content ?? '',
        contentEncoding: after.encoding
      })
    }

    // Deleted
    for (const [filePath, before] of baseline) {
      if (already.has(filePath)) continue
      if (current.has(filePath)) continue
      this.upsertPending(conversationId, workdir, {
        filePath,
        changeType: 'deleted',
        originalContent: before.content,
        newContent: '',
        contentEncoding: before.encoding
      })
    }
  }

  private pruneActive(set: ChangeSet): void {
    const status = summarizeChangeSetStatus(set.files)
    set.status = status
    if (status === 'accepted' || status === 'rejected') {
      if (set.files.every((f) => f.status !== 'pending')) {
        const active = this.activeByConversation.get(set.conversationId)
        if (active === set.id) this.activeByConversation.delete(set.conversationId)
      }
    }
  }
}

async function captureBaseline(workdir: string): Promise<Map<string, BaselineFile>> {
  const meta = await walkFileMeta(workdir)
  const out = new Map<string, BaselineFile>()
  for (const [filePath, m] of meta) {
    const snap = await readSnapshot(filePath)
    out.set(filePath, {
      size: m.size,
      mtimeMs: m.mtimeMs,
      content: snap?.content ?? null,
      encoding: snap?.encoding ?? (isLikelyBinaryPath(filePath) ? 'base64' : 'utf8')
    })
  }
  return out
}

async function walkFileMeta(
  root: string
): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const out = new Map<string, { size: number; mtimeMs: number }>()
  async function walk(dir: string, depth: number): Promise<void> {
    if (out.size >= WALK_MAX_FILES || depth > WALK_MAX_DEPTH) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (out.size >= WALK_MAX_FILES) return
      const name = ent.name
      if (IGNORE_NAMES.has(name) || name.startsWith('~$')) continue
      const full = join(dir, name)
      if (ent.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!ent.isFile()) continue
      try {
        const st = await stat(full)
        out.set(full, { size: st.size, mtimeMs: st.mtimeMs })
      } catch {
        // ignore
      }
    }
  }
  await walk(root, 0)
  return out
}

async function readSnapshot(
  filePath: string
): Promise<{ content: string | null; encoding: ChangeContentEncoding } | null> {
  try {
    const st = await stat(filePath)
    if (!st.isFile()) return null
    const binary = isLikelyBinaryPath(filePath)
    if (st.size > SNAPSHOT_MAX_BYTES) {
      return { content: null, encoding: binary ? 'base64' : 'utf8' }
    }
    if (binary) {
      const buf = await readFile(filePath)
      return { content: buf.toString('base64'), encoding: 'base64' }
    }
    // Heuristic: NUL → treat as binary
    const buf = await readFile(filePath)
    if (buf.includes(0)) {
      return { content: buf.toString('base64'), encoding: 'base64' }
    }
    return { content: buf.toString('utf8'), encoding: 'utf8' }
  } catch {
    return null
  }
}

function summarizeDiff(input: {
  changeType: ChangeType
  originalContent: string | null
  newContent: string
  contentEncoding: ChangeContentEncoding
  filePath?: string
}): string {
  if (input.contentEncoding === 'base64' || (input.filePath && isLikelyBinaryPath(input.filePath))) {
    return binarySummary(input.changeType, input.originalContent, input.newContent, input.filePath)
  }
  if (input.changeType === 'deleted') {
    const lines = (input.originalContent ?? '').split('\n').length
    return unifiedDiff(input.originalContent, '') ?? `−${lines} lines (deleted)`
  }
  return (
    unifiedDiff(input.originalContent, input.newContent) ??
    (input.changeType === 'added'
      ? `+${input.newContent.split('\n').length} lines`
      : '(unchanged)')
  )
}

function binarySummary(
  changeType: ChangeType,
  originalContent: string | null,
  newContent: string,
  filePath?: string
): string {
  const kind = binaryKindLabel(filePath ?? '')
  const after = newContent ? approxBase64Bytes(newContent) : 0
  const before = originalContent ? approxBase64Bytes(originalContent) : 0
  if (changeType === 'added') return `Binary file · ${kind} · ${formatBytes(after)} (new)`
  if (changeType === 'deleted') return `Binary file · ${kind} · ${formatBytes(before)} (deleted)`
  const delta = after - before
  const deltaLabel =
    delta === 0 ? 'size unchanged' : delta > 0 ? `+${formatBytes(delta)}` : `−${formatBytes(-delta)}`
  return `Binary file · ${kind} · ${formatBytes(before)} → ${formatBytes(after)} (${deltaLabel})`
}

function binaryKindLabel(path: string): string {
  const ext = extname(path).replace(/^\./, '').toUpperCase()
  if (!ext) return 'Raw'
  if (/^DOCX?$/i.test(ext)) return 'DOCX'
  if (/^XLSX?$/i.test(ext)) return 'XLSX'
  if (/^PPTX?$/i.test(ext)) return 'PPTX'
  return ext
}

function approxBase64Bytes(b64: string): number {
  // base64 length → byte length (padding-aware enough for UI)
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad)
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

async function restoreFile(file: ChangeEntry): Promise<void> {
  if (file.changeType === 'added' || file.originalContent === null) {
    try {
      await unlink(file.filePath)
    } catch {
      // Already gone.
    }
    return
  }
  await writeEntryContent(file.filePath, file.originalContent, file.contentEncoding ?? 'utf8')
}

async function writeEntryContent(
  filePath: string,
  content: string,
  encoding: ChangeContentEncoding
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  if (encoding === 'base64') {
    await writeFile(filePath, Buffer.from(content, 'base64'))
  } else {
    await writeFile(filePath, content, 'utf8')
  }
}

function toRelative(workdir: string, filePath: string): string {
  const rel = relative(workdir, filePath)
  return rel && !rel.startsWith('..') ? rel : filePath
}
