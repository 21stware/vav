import { randomUUID } from 'node:crypto'
import { relative } from 'node:path'
import { writeFile, unlink, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  computeRisk,
  summarizeChangeSetStatus,
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
}

/**
 * Accumulates fs_write results for one agent turn, then freezes them into a
 * ChangeSet the renderer can Accept / Reject.
 *
 * Writes already landed on disk during the turn — Accept keeps them, Reject
 * restores `originalContent` (or deletes a newly added file).
 */
export class ChangeSetStore {
  private pending = new Map<string, PendingWrite[]>()
  private sets = new Map<string, ChangeSet>()
  /** conversationId → active review set id (latest unresolved). */
  private activeByConversation = new Map<string, string>()

  beginTurn(conversationId: string): void {
    this.pending.set(conversationId, [])
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
  }

  recordWrite(
    conversationId: string,
    workdir: string,
    filePath: string,
    originalContent: string | null,
    newContent: string
  ): void {
    const list = this.pending.get(conversationId) ?? []
    this.pending.set(conversationId, list)

    const changeType: ChangeType = originalContent === null ? 'added' : 'modified'
    const diffText =
      unifiedDiff(originalContent, newContent) ??
      (changeType === 'added' ? `+${newContent.split('\n').length} lines` : '(unchanged)')
    const relativePath = toRelative(workdir, filePath)

    const existing = list.findIndex((e) => e.filePath === filePath)
    const entry: PendingWrite = {
      filePath,
      relativePath,
      changeType,
      diffText,
      originalContent,
      newContent
    }
    if (existing >= 0) list[existing] = entry
    else list.push(entry)
  }

  /**
   * Freeze pending writes into a ChangeSet. Returns null when nothing to review
   * (or the turn was cancelled / errored with no writes).
   */
  finalizeTurn(
    conversationId: string,
    turnTitle: string,
    model: string,
    opts?: { cancelled?: boolean; error?: boolean }
  ): ChangeSet | null {
    const list = this.pending.get(conversationId) ?? []
    this.pending.delete(conversationId)
    if (opts?.cancelled || opts?.error || list.length === 0) return null

    const files: ChangeEntry[] = list.map((e) => ({
      ...e,
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
      await mkdir(dirname(file.filePath), { recursive: true })
      await writeFile(file.filePath, file.newContent, 'utf8')
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
    await mkdir(dirname(file.filePath), { recursive: true })
    await writeFile(file.filePath, content, 'utf8')
    file.newContent = content
    file.diffText =
      unifiedDiff(file.originalContent, content) ??
      (file.changeType === 'added' ? `+${content.split('\n').length} lines` : '(edited)')
    file.status = 'edited'
    set.status = summarizeChangeSetStatus(set.files)
    this.pruneActive(set)
    return set
  }

  private pruneActive(set: ChangeSet): void {
    const status = summarizeChangeSetStatus(set.files)
    set.status = status
    if (status === 'accepted' || status === 'rejected') {
      // Keep set for history of the session view, but clear "pending review" banner
      // when nothing is left pending.
      if (set.files.every((f) => f.status !== 'pending')) {
        const active = this.activeByConversation.get(set.conversationId)
        if (active === set.id) this.activeByConversation.delete(set.conversationId)
      }
    }
  }
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
  await mkdir(dirname(file.filePath), { recursive: true })
  await writeFile(file.filePath, file.originalContent, 'utf8')
}

function toRelative(workdir: string, filePath: string): string {
  const rel = relative(workdir, filePath)
  return rel && !rel.startsWith('..') ? rel : filePath
}
