import { shell } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { readdir, rename, stat, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname, basename, extname } from 'node:path'
import { spawn } from 'node:child_process'
import type { FileInspectResult, FilePreviewKind } from '@shared/ipc'
import {
  DIRECTORY_ENTRY_CAP,
  isIgnoredName,
  type DirectoryListing,
  type FileEntry,
  type FileSortKey
} from '@shared/types'
import { t } from '../i18n'

const WATCH_DEBOUNCE_MS = 300
const TEXT_PREVIEW_CAP = 512 * 1024
const MEDIA_PREVIEW_CAP = 12 * 1024 * 1024

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
      const visible = dirents.filter((d) => !isIgnoredName(d.name))
      const truncated = Math.max(0, visible.length - DIRECTORY_ENTRY_CAP)
      const slice = visible.slice(0, DIRECTORY_ENTRY_CAP)

      const entries = await Promise.all(
        slice.map(async (dirent): Promise<FileEntry> => {
          const full = join(path, dirent.name)
          let size = 0
          let modifiedAt = 0
          let createdAt = 0
          try {
            const info = await stat(full)
            size = info.size
            modifiedAt = info.mtimeMs
            createdAt = info.birthtimeMs || info.ctimeMs || info.mtimeMs
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
            createdAt,
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
      if (info.isDirectory()) return { content: '', truncated: false, error: t('files.error.directory') }
      const buffer = await readFile(path)
      const slice = buffer.subarray(0, TEXT_PREVIEW_CAP)
      if (slice.includes(0)) return { content: '', truncated: false, error: t('files.error.binary') }
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

  async rename(
    path: string,
    newName: string
  ): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    const name = newName.trim()
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      return { ok: false, error: t('files.error.badName') }
    }
    const target = join(dirname(path), name)
    try {
      await rename(path, target)
      return { ok: true, path: target }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  async trash(paths: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      for (const path of paths) {
        await shell.trashItem(path)
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  async inspect(path: string): Promise<FileInspectResult> {
    const name = basename(path)
    try {
      const info = await stat(path)
      if (info.isDirectory()) {
        return { path, name, size: 0, kind: 'binary', mime: '', error: t('files.error.directory') }
      }
      const kind = previewKind(name)
      const mime = mimeFor(name, kind)
      const base = { path, name, size: info.size, kind, mime }
      if (kind === 'text' || kind === 'csv') {
        const text = await this.readTextFile(path)
        if (text.error) return { ...base, error: text.error }
        const content = text.content
        return {
          ...base,
          text: content,
          truncated: text.truncated,
          lineCount: content ? content.split(/\r?\n/).length : 0
        }
      }
      if (kind === 'image' || kind === 'audio' || kind === 'video') {
        if (info.size > MEDIA_PREVIEW_CAP) {
          return { ...base, error: t('files.error.tooLarge') }
        }
        const buffer = await readFile(path)
        return { ...base, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` }
      }
      if (kind === 'pdf') {
        // Renderer opens via Quick Look / system handler; metadata only here.
        return base
      }
      return { ...base, error: t('files.error.unsupported') }
    } catch (err) {
      return {
        path,
        name,
        size: 0,
        kind: 'binary',
        mime: '',
        error: (err as Error).message
      }
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
        if (isIgnoredName(name)) return
        const full = join(root, filename.toString())
        // Windows reports `node_modules\pkg\file`, POSIX `node_modules/pkg/file`.
        if (full.split(/[\\/]/).some((part) => isIgnoredName(part))) return
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

function previewKind(name: string): FilePreviewKind {
  const ext = extname(name).toLowerCase()
  if (ext === '.csv') return 'csv'
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) return 'image'
  if (ext === '.pdf') return 'pdf'
  if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(ext)) return 'audio'
  if (['.mp4', '.mov', '.webm', '.mkv', '.m4v'].includes(ext)) return 'video'
  if (
    [
      '.swift',
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.py',
      '.rb',
      '.go',
      '.rs',
      '.java',
      '.kt',
      '.c',
      '.h',
      '.cpp',
      '.cc',
      '.hpp',
      '.cs',
      '.md',
      '.txt',
      '.json',
      '.yml',
      '.yaml',
      '.toml',
      '.xml',
      '.html',
      '.css',
      '.scss',
      '.less',
      '.sh',
      '.zsh',
      '.bash',
      '.sql',
      '.graphql',
      '.env',
      '.gitignore',
      '.dockerignore',
      '.editorconfig',
      '.rpml',
      '.log'
    ].includes(ext) ||
    !ext
  ) {
    return 'text'
  }
  return 'binary'
}

function mimeFor(name: string, kind: FilePreviewKind): string {
  const ext = extname(name).toLowerCase()
  switch (kind) {
    case 'image':
      if (ext === '.png') return 'image/png'
      if (ext === '.gif') return 'image/gif'
      if (ext === '.webp') return 'image/webp'
      if (ext === '.svg') return 'image/svg+xml'
      return 'image/jpeg'
    case 'audio':
      if (ext === '.wav') return 'audio/wav'
      if (ext === '.m4a') return 'audio/mp4'
      return 'audio/mpeg'
    case 'video':
      if (ext === '.webm') return 'video/webm'
      if (ext === '.mov') return 'video/quicktime'
      return 'video/mp4'
    case 'pdf':
      return 'application/pdf'
    case 'csv':
      return 'text/csv'
    default:
      return 'text/plain'
  }
}

function sortEntries(entries: FileEntry[], key: FileSortKey, ascending: boolean): FileEntry[] {
  if (key === 'none') return entries

  const direction = ascending ? 1 : -1
  const byName = (a: FileEntry, b: FileEntry): number =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

  return [...entries].sort((a, b) => {
    // Folders lead for every sort except raw filesystem order (`none`).
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    let cmp = 0
    switch (key) {
      case 'date':
      case 'dateModified':
        cmp = a.modifiedAt - b.modifiedAt
        break
      case 'dateCreated':
      case 'dateAdded':
        cmp = (a.createdAt || a.modifiedAt) - (b.createdAt || b.modifiedAt)
        break
      case 'size':
        cmp = a.size - b.size
        break
      case 'kind': {
        cmp = kindLabel(a).localeCompare(kindLabel(b))
        break
      }
      case 'application': {
        cmp = applicationLabel(a).localeCompare(applicationLabel(b))
        break
      }
      case 'tags':
        // Tags need Spotlight xattrs; without them keep a stable name order.
        cmp = 0
        break
      case 'name':
      default:
        cmp = byName(a, b)
        break
    }
    if (cmp === 0) cmp = byName(a, b)
    return cmp * direction
  })
}

function kindLabel(entry: FileEntry): string {
  if (entry.isDirectory) return 'Folder'
  const ext = extname(entry.name).toLowerCase()
  return ext ? ext.slice(1).toUpperCase() : 'Document'
}

/** Best-effort “opens with” grouping when Launch Services isn’t available. */
function applicationLabel(entry: FileEntry): string {
  if (entry.isDirectory) return 'Finder'
  const ext = extname(entry.name).toLowerCase()
  switch (ext) {
    case '.swift':
    case '.m':
    case '.mm':
    case '.h':
    case '.xcodeproj':
      return 'Xcode'
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
    case '.json':
    case '.md':
    case '.css':
    case '.html':
      return 'Editor'
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.webp':
    case '.svg':
      return 'Preview'
    case '.pdf':
      return 'Preview'
    case '.mp3':
    case '.wav':
    case '.m4a':
    case '.mp4':
    case '.mov':
      return 'QuickTime Player'
    case '.sh':
    case '.zsh':
    case '.bash':
      return 'Terminal'
    case '.app':
      return entry.name
    default:
      return ext ? ext.slice(1).toUpperCase() : 'Other'
  }
}
