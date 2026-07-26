import { shell } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { readdir, stat, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname, basename, extname } from 'node:path'
import { spawn } from 'node:child_process'
import {
  DIRECTORY_ENTRY_CAP,
  IGNORED_NAMES,
  type DirectoryListing,
  type FileEntry,
  type FileSortKey
} from '@shared/types'

const WATCH_DEBOUNCE_MS = 300
const TEXT_PREVIEW_CAP = 512 * 1024

/**
 * Filesystem access for both the Files panel and the agent's fs_* tools.
 *
 * All enumeration is async and happens in the main process, so a large
 * directory can never stall the renderer (README §8: no main-thread directory
 * enumeration).
 */
export class FileService {
  private watchers = new Map<string, FSWatcher>()
  private pendingDirs = new Map<string, Set<string>>()
  private debounceTimers = new Map<string, NodeJS.Timeout>()

  constructor(private onDirtyDirectories: (conversationId: string, dirs: string[]) => void) {}

  /** Loads exactly one level; callers expand lazily as the user opens folders. */
  async listDirectory(path: string, sort: FileSortKey = 'name', ascending = true): Promise<DirectoryListing> {
    try {
      const dirents = await readdir(path, { withFileTypes: true })
      const visible = dirents.filter((d) => !IGNORED_NAMES.has(d.name))
      const truncated = Math.max(0, visible.length - DIRECTORY_ENTRY_CAP)
      const slice = visible.slice(0, DIRECTORY_ENTRY_CAP)

      const entries = await Promise.all(
        slice.map(async (dirent): Promise<FileEntry> => {
          const full = join(path, dirent.name)
          let size = 0
          let modifiedAt = 0
          try {
            const info = await stat(full)
            size = info.size
            modifiedAt = info.mtimeMs
          } catch {
            // Broken symlink or a race with an external delete; show it as empty.
          }
          const isDirectory = dirent.isDirectory()
          return {
            path: full,
            name: dirent.name,
            isDirectory,
            size,
            modifiedAt,
            children: isDirectory ? null : undefined
          }
        })
      )

      return { path, entries: sortEntries(entries, sort, ascending), truncated }
    } catch (err) {
      return { path, entries: [], truncated: 0, error: (err as Error).message }
    }
  }

  async readTextFile(path: string): Promise<{ content: string; truncated: boolean; error?: string }> {
    try {
      const info = await stat(path)
      if (info.isDirectory()) return { content: '', truncated: false, error: '这是一个目录' }
      const buffer = await readFile(path)
      const slice = buffer.subarray(0, TEXT_PREVIEW_CAP)
      if (slice.includes(0)) return { content: '', truncated: false, error: '二进制文件，无法预览' }
      return { content: slice.toString('utf8'), truncated: buffer.length > TEXT_PREVIEW_CAP }
    } catch (err) {
      return { content: '', truncated: false, error: (err as Error).message }
    }
  }

  async writeTextFile(path: string, content: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  /**
   * Preview the selected file (Space, or double-click, in the Files panel).
   *
   * Quick Look is the whole point on macOS: a peek that never leaves the app.
   * Nothing else has an equivalent, so elsewhere the file opens in whatever
   * the system associates with it — a heavier action, but the same intent.
   */
  preview(path: string): void {
    if (process.platform === 'darwin') {
      spawn('qlmanage', ['-p', path], { stdio: 'ignore', detached: true }).unref()
      return
    }
    void shell.openPath(path)
  }

  /**
   * Watches a conversation's root. Change notifications are coalesced over
   * 300 ms and reported as parent directories, so the renderer refreshes only
   * the subtrees it actually has expanded.
   */
  watchRoot(conversationId: string, root: string | null): void {
    this.unwatch(conversationId)
    if (!root) return
    try {
      const watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const name = basename(filename.toString())
        if (IGNORED_NAMES.has(name)) return
        const full = join(root, filename.toString())
        // Windows reports `node_modules\pkg\file`, POSIX `node_modules/pkg/file`.
        if (full.split(/[\\/]/).some((part) => IGNORED_NAMES.has(part))) return
        this.markDirty(conversationId, dirname(full))
      })
      watcher.on('error', () => this.unwatch(conversationId))
      this.watchers.set(conversationId, watcher)
    } catch {
      // Unreadable roots simply go unwatched; listDirectory still reports errors.
    }
  }

  /** fs_write refreshes the written file's parent only, never the whole tree. */
  markDirty(conversationId: string, dir: string): void {
    let set = this.pendingDirs.get(conversationId)
    if (!set) {
      set = new Set()
      this.pendingDirs.set(conversationId, set)
    }
    set.add(dir)

    const existing = this.debounceTimers.get(conversationId)
    if (existing) clearTimeout(existing)
    this.debounceTimers.set(
      conversationId,
      setTimeout(() => {
        this.debounceTimers.delete(conversationId)
        const dirs = [...(this.pendingDirs.get(conversationId) ?? [])]
        this.pendingDirs.delete(conversationId)
        if (dirs.length) this.onDirtyDirectories(conversationId, dirs)
      }, WATCH_DEBOUNCE_MS)
    )
  }

  unwatch(conversationId: string): void {
    this.watchers.get(conversationId)?.close()
    this.watchers.delete(conversationId)
    const timer = this.debounceTimers.get(conversationId)
    if (timer) clearTimeout(timer)
    this.debounceTimers.delete(conversationId)
    this.pendingDirs.delete(conversationId)
  }

  disposeAll(): void {
    for (const id of [...this.watchers.keys()]) this.unwatch(id)
  }
}

function sortEntries(entries: FileEntry[], key: FileSortKey, ascending: boolean): FileEntry[] {
  const direction = ascending ? 1 : -1
  return [...entries].sort((a, b) => {
    // Folders always lead, regardless of sort key or direction.
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    switch (key) {
      case 'date':
        return (a.modifiedAt - b.modifiedAt) * direction
      case 'size':
        return (a.size - b.size) * direction
      case 'kind': {
        const cmp = extname(a.name).localeCompare(extname(b.name))
        return (cmp !== 0 ? cmp : a.name.localeCompare(b.name)) * direction
      }
      default:
        return a.name.localeCompare(b.name, 'zh-Hans-CN') * direction
    }
  })
}
