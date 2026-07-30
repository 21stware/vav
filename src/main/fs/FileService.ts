import { shell } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { readdir, rename, stat, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname, basename, extname } from 'node:path'
import { spawn } from 'node:child_process'
import { userInfo } from 'node:os'
import JSZip from 'jszip'
import type {
  BinaryFileMeta,
  FileInspectResult,
  FilePreviewKind,
  SqliteQueryResult,
  ZipArchiveInfo,
  ZipEntryInfo
} from '@shared/ipc'
import { inspectSqlite, isSqlitePath, querySqliteTable } from './SqliteService'
import {
  DIRECTORY_ENTRY_CAP,
  isIgnoredName,
  type DirectoryListing,
  type FileEntry,
  type FileSortKey
} from '@shared/types'
import { t } from '../i18n'
import { isOfficeLockFile, parseStructuredDocument } from './office'
import { OFFICE_LOCK_FILE_MESSAGE } from '@shared/officeLock'
import type { DocumentRetrievalService } from '../retrieval/DocumentRetrievalService'

/** Soft budget for base64 office loads (docx/xlsx/pptx). PDF streams instead. */
const BINARY_PREVIEW_CAP = 200 * 1024 * 1024

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
  /** Optional: warm document RAG index after office inspect. */
  retrieval: DocumentRetrievalService | null = null

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
      // Refuse to clobber OOXML/PDF with UTF-8 text — agents must use binary-aware
      // tools (or a shell) for those formats.
      const ext = extname(path).toLowerCase()
      if (['.docx', '.xlsx', '.pptx', '.pdf'].includes(ext)) {
        return {
          ok: false,
          error: `Cannot write ${ext} as UTF-8 text (would corrupt the file). Use a format-aware tool or shell for binary office documents.`
        }
      }
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  /** Restore or write raw file bytes (base64), used for office discard/accept. */
  async writeBinary(path: string, base64: string): Promise<{ ok: boolean; error?: string }> {
    try {
      if (isOfficeLockFile(path)) {
        return { ok: false, error: OFFICE_LOCK_FILE_MESSAGE }
      }
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, Buffer.from(base64, 'base64'))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  /**
   * Raw bytes for client-side mature renderers (docx-preview / pdf.js / SheetJS).
   */
  async readBinary(
    path: string
  ): Promise<
    { ok: true; base64: string; size: number; mime: string } | { ok: false; error: string }
  > {
    try {
      if (isOfficeLockFile(path)) {
        return { ok: false, error: OFFICE_LOCK_FILE_MESSAGE }
      }
      const info = await stat(path)
      if (info.isDirectory()) return { ok: false, error: t('files.error.directory') }
      if (info.size <= 0) return { ok: false, error: 'File is empty.' }
      if (info.size > BINARY_PREVIEW_CAP) {
        return {
          ok: false,
          error: `File too large for in-app preview (${Math.round(info.size / 1024 / 1024)} MB)`
        }
      }
      const kind = previewKind(basename(path))
      const buffer = await readFile(path)
      return {
        ok: true,
        base64: buffer.toString('base64'),
        size: buffer.length,
        mime: mimeFor(basename(path), kind)
      }
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
      let kind = previewKind(name)
      if (kind === 'binary' && (await looksLikeTextFile(path, info.size))) {
        kind = 'text'
      }
      const mime = mimeFor(name, kind)
      const base = { path, name, size: info.size, mtimeMs: info.mtimeMs, kind, mime }
      if (kind === 'text' || kind === 'csv') {
        const text = await this.readTextFile(path)
        if (text.error) return { ...base, error: text.error }
        const content = text.content
        // CSV structured index for doc_search — defer so inspect stays snappy.
        if (kind === 'csv') {
          setTimeout(() => {
            void this.retrieval?.ensureIndex(path).catch(() => {})
          }, 0)
        }
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
      if (kind === 'sqlite') {
        try {
          const sqlite = inspectSqlite(path)
          const summary = sqlite.tables
            .map((t) => `${t.name} (${t.rowCount} rows · ${t.columns.length} cols)`)
            .join('\n')
          return {
            ...base,
            sqlite,
            text: summary || '(no tables)',
            lineCount: sqlite.tables.length
          }
        } catch (err) {
          return { ...base, error: (err as Error).message || t('files.error.unsupported') }
        }
      }
      if (kind === 'zip') {
        // Structure-only tree. Never hard-fail to the old "unsupported" alert —
        // on parse/size issues still open the ZIP canvas (empty/truncated).
        try {
          if (info.size > BINARY_PREVIEW_CAP) {
            return {
              ...base,
              zip: {
                entries: [],
                entryCount: 0,
                compressedSize: info.size,
                uncompressedSize: 0,
                ratio: 0
              },
              truncated: true,
              text: '',
              lineCount: 0
            }
          }
          const zip = await inspectZipArchive(path, info.size)
          const treeText = zip.entries
            .map((e) => `${e.isDirectory ? 'D' : 'F'} ${e.path}`)
            .join('\n')
          return {
            ...base,
            zip,
            text: treeText,
            lineCount: zip.entries.length
          }
        } catch (err) {
          console.error('[files] zip inspect failed', path, err)
          // Keep kind=zip so the archive UI mounts; empty tree + truncated flag.
          return {
            ...base,
            zip: {
              entries: [],
              entryCount: 0,
              compressedSize: info.size,
              uncompressedSize: 0,
              ratio: 0
            },
            truncated: true,
            text: '',
            lineCount: 0
          }
        }
      }
      if (kind === 'pdf' || kind === 'docx' || kind === 'xlsx' || kind === 'pptx') {
        if (isOfficeLockFile(path)) {
          return { ...base, error: OFFICE_LOCK_FILE_MESSAGE }
        }
        if (info.size <= 0) return { ...base, error: 'File is empty.' }
        // PDF opens via vav-local:// streaming in the renderer — no whole-file
        // base64 round-trip, so size is not a hard fail. OOXML still needs
        // readBinary (base64), so keep the cap for those.
        if (kind !== 'pdf' && info.size > BINARY_PREVIEW_CAP) {
          return {
            ...base,
            error: t('files.error.tooLarge')
          }
        }
        // PDF: never block open on a full-document text index (can take seconds
        // on 100+ page files). Preview mounts immediately; RAG indexes later.
        if (kind === 'pdf') {
          setTimeout(() => {
            void this.retrieval?.ensureIndex(path).catch(() => {})
          }, 0)
          return base
        }
        // OOXML: light structured index for selection/search (best-effort).
        if (info.size <= BINARY_PREVIEW_CAP) {
          try {
            const structured = await parseStructuredDocument(path, info.size)
            setTimeout(() => {
              void this.retrieval?.ensureIndex(path).catch(() => {})
            }, 0)
            return {
              ...base,
              structured,
              text: structured.plainText,
              lineCount: structured.plainText
                ? structured.plainText.split(/\r?\n/).length
                : 0,
              truncated: !!structured.warnings?.length
            }
          } catch {
            // Still openable by client renderer even if text index fails.
          }
        }
        return base
      }
      // Unsupported / binary: metadata panel (no content preview). Never use
      // files.error.unsupported — that red alert is reserved for real I/O failures.
      try {
        const binaryMeta = await buildBinaryMeta(path, info)
        return { ...base, binaryMeta }
      } catch (metaErr) {
        console.error('[files] binary meta failed', path, metaErr)
        return {
          ...base,
          binaryMeta: {
            uti: 'public.data',
            permissions: '—',
            owner: '—',
            createdAt: null,
            modifiedAt: Number.isFinite(info.mtimeMs) ? info.mtimeMs : null,
            inode: '—',
            defaultApp: null
          }
        }
      }
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

  /** Page through a SQLite table for the DB preview canvas. */
  dbQuery(path: string, table: string, offset?: number, limit?: number): SqliteQueryResult {
    if (!isSqlitePath(path)) {
      return {
        columns: [],
        rows: [],
        total: 0,
        offset: offset ?? 0,
        limit: limit ?? 100,
        error: 'Not a SQLite database path'
      }
    }
    return querySqliteTable(path, table, offset, limit)
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
   * Open with the OS default application (not Quick Look).
   * Returns `{ ok }` so the UI can toast — silent failures looked like a dead button.
   */
  async openWithDefault(path: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      if (process.platform === 'darwin') {
        // `open` routes through Launch Services (DMG → DiskImageMounter, etc.).
        await new Promise<void>((resolve, reject) => {
          const child = spawn('open', [path], { stdio: ['ignore', 'ignore', 'pipe'] })
          let stderr = ''
          child.stderr?.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8')
          })
          child.on('error', reject)
          child.on('close', (code) => {
            if (code === 0) resolve()
            else reject(new Error(stderr.trim() || `open exited with code ${code}`))
          })
        })
        return { ok: true }
      }
      const err = await shell.openPath(path)
      if (err) return { ok: false, error: err }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message || 'Could not open file' }
    }
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

/** Known text / source extensions for in-app preview (plus extensionless names). */
const TEXT_EXTENSIONS = new Set([
  // JS / TS
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  // Python / scripting
  '.py',
  '.pyi',
  '.pyw',
  '.rb',
  '.php',
  '.pl',
  '.pm',
  '.lua',
  '.r',
  '.jl',
  // Systems
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.cxx',
  '.hpp',
  '.hh',
  '.m',
  '.mm',
  '.swift',
  '.go',
  '.rs',
  '.zig',
  '.nim',
  '.cs',
  '.fs',
  '.fsx',
  '.java',
  '.kt',
  '.kts',
  '.scala',
  '.groovy',
  '.dart',
  '.ex',
  '.exs',
  '.erl',
  '.hrl',
  '.hs',
  '.lhs',
  '.clj',
  '.cljs',
  '.edn',
  // Web / markup
  '.html',
  '.htm',
  '.xhtml',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.vue',
  '.svelte',
  '.astro',
  '.xml',
  '.xsl',
  '.xslt',
  '.svg',
  // Data / config
  '.json',
  '.jsonc',
  '.json5',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.config',
  '.properties',
  '.env',
  '.envrc',
  '.plist',
  '.tf',
  '.hcl',
  '.tfvars',
  '.proto',
  '.graphql',
  '.gql',
  '.sql',
  '.prisma',
  // Docs
  '.md',
  '.markdown',
  '.mdx',
  '.rst',
  '.adoc',
  '.tex',
  '.txt',
  '.text',
  '.log',
  '.csv',
  '.tsv',
  '.ipynb',
  '.rpml',
  // Shell / build
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.psm1',
  '.bat',
  '.cmd',
  '.cmake',
  '.make',
  '.mk',
  '.gradle',
  '.dockerignore',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
  '.prettierrc',
  '.eslintrc',
  '.babelrc',
  '.lock'
])

const TEXT_BASENAMES = new Set([
  'dockerfile',
  'makefile',
  'gnumakefile',
  'cmakelists.txt',
  'readme',
  'license',
  'licence',
  'changelog',
  'authors',
  'gemfile',
  'rakefile',
  'procfile',
  'vagrantfile',
  'brewfile',
  'justfile'
])

function previewKind(name: string): FilePreviewKind {
  const base = name.toLowerCase()
  const ext = extname(name).toLowerCase()
  if (ext === '.csv' || ext === '.tsv') return 'csv'
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif'].includes(ext)) {
    return 'image'
  }
  if (ext === '.pdf') return 'pdf'
  if (ext === '.zip') return 'zip'
  if (ext === '.docx') return 'docx'
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx'
  if (ext === '.pptx') return 'pptx'
  if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3' || ext === '.db3') return 'sqlite'
  if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus'].includes(ext)) return 'audio'
  if (['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi'].includes(ext)) return 'video'
  if (TEXT_EXTENSIONS.has(ext) || TEXT_BASENAMES.has(base) || !ext) {
    return 'text'
  }
  // Dotfiles without a second extension (e.g. `.env.local` handled via .local? —
  // `.env*` often ends with a non-empty ext; also accept `.*rc` / `.*ignore`).
  if (
    base.startsWith('.') &&
    (base.endsWith('rc') ||
      base.endsWith('ignore') ||
      base.startsWith('.env') ||
      base.includes('eslint') ||
      base.includes('prettier') ||
      base.includes('babel'))
  ) {
    return 'text'
  }
  return 'binary'
}

/** Treat unknown extensions as text when the buffer looks like UTF-8 source. */
async function looksLikeTextFile(path: string, size: number): Promise<boolean> {
  if (size <= 0 || size > TEXT_PREVIEW_CAP) return false
  try {
    const sampleSize = Math.min(size, 8192)
    const buf = (await readFile(path)).subarray(0, sampleSize)
    if (buf.includes(0)) return false
    const text = buf.toString('utf8')
    // Reject if replacement chars dominate (invalid UTF-8) or control chars abound.
    let bad = 0
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i)
      if (code === 0xfffd) bad += 1
      else if (code < 9 || (code > 13 && code < 32)) bad += 1
    }
    return bad / Math.max(text.length, 1) < 0.02
  } catch {
    return false
  }
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
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case 'csv':
      return 'text/csv'
    case 'sqlite':
      return 'application/vnd.sqlite3'
    case 'zip':
      return 'application/zip'
    case 'binary': {
      if (ext === '.dmg') return 'application/x-apple-diskimage'
      if (ext === '.apk') return 'application/vnd.android.package-archive'
      if (ext === '.pkg') return 'application/x-newton-compatible-pkg'
      return 'application/octet-stream'
    }
    default:
      return 'text/plain'
  }
}

function modeToPermissions(mode: number): string {
  const perms = mode & 0o777
  const rwx = (n: number): string =>
    `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`
  const owner = rwx((perms >> 6) & 7)
  const group = rwx((perms >> 3) & 7)
  const other = rwx(perms & 7)
  const octal = perms.toString(8).padStart(3, '0')
  return `-${owner}${group}${other} (${octal})`
}

async function buildBinaryMeta(
  path: string,
  info: {
    mode?: number
    uid?: number
    gid?: number
    ino?: number | bigint
    birthtimeMs?: number
    mtimeMs?: number
    birthtime?: Date
    mtime?: Date
  }
): Promise<BinaryFileMeta> {
  const mode = typeof info.mode === 'number' ? info.mode : 0
  const uid = typeof info.uid === 'number' ? info.uid : -1
  let owner = uid >= 0 ? String(uid) : '—'
  try {
    const me = userInfo()
    if (uid >= 0 && me.uid === uid) owner = me.username
  } catch {
    // keep numeric uid
  }
  const createdMs =
    typeof info.birthtimeMs === 'number' && Number.isFinite(info.birthtimeMs)
      ? info.birthtimeMs
      : info.birthtime instanceof Date
        ? info.birthtime.getTime()
        : null
  const modifiedMs =
    typeof info.mtimeMs === 'number' && Number.isFinite(info.mtimeMs)
      ? info.mtimeMs
      : info.mtime instanceof Date
        ? info.mtime.getTime()
        : null
  const inode =
    info.ino === undefined || info.ino === null ? '—' : String(info.ino)

  let uti = mimeHintToUti(extname(path).toLowerCase())
  let defaultApp: string | null = null
  if (process.platform === 'darwin') {
    try {
      const mdlsUti = await mdlsRaw(path, 'kMDItemContentType')
      if (mdlsUti && mdlsUti !== '(null)') uti = mdlsUti
    } catch {
      // keep heuristic uti
    }
    try {
      // Display name of the default handler, e.g. "DiskImageMounter".
      defaultApp = await defaultAppDisplayName(path)
    } catch {
      defaultApp = null
    }
  }

  return {
    uti,
    permissions: mode ? modeToPermissions(mode) : '—',
    owner,
    createdAt: createdMs,
    modifiedAt: modifiedMs,
    inode,
    defaultApp
  }
}

function mimeHintToUti(ext: string): string {
  switch (ext) {
    case '.dmg':
      return 'com.apple.disk-image-udif'
    case '.pkg':
      return 'com.apple.installer-package-archive'
    case '.app':
      return 'com.apple.application-bundle'
    case '.zip':
      return 'com.pkware.zip-archive'
    case '.apk':
      return 'com.android.package-archive'
    default:
      return 'public.data'
  }
}

function mdlsRaw(path: string, key: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('mdls', ['-raw', '-name', key, path], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim())
      else reject(new Error(`mdls exit ${code}`))
    })
  })
}

/**
 * macOS: display name of the default app that would open this path
 * (e.g. "DiskImageMounter"). Uses JXA + AppKit, capped at 1s.
 */
function defaultAppDisplayName(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const escaped = filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const script = `
      ObjC.import('AppKit');
      var url = $.NSURL.fileURLWithPath('${escaped}');
      var appURL = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL(url);
      if (!appURL) { ''; }
      else {
        var p = ObjC.unwrap(appURL.path);
        var parts = p.split('/');
        var name = parts[parts.length - 1] || '';
        name.replace(/\\.app$/i, '');
      }
    `
    const child = spawn('osascript', ['-l', 'JavaScript', '-e', script], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let out = ''
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.on('error', () => finish(null))
    child.on('close', () => finish(out.trim() || null))
    setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      finish(out.trim() || null)
    }, 1000)
  })
}

/** Structure-only ZIP index for the archive tree preview (no entry contents). */
async function inspectZipArchive(path: string, fileSize: number): Promise<ZipArchiveInfo> {
  const buffer = await readFile(path)
  const zip = await JSZip.loadAsync(buffer, { createFolders: true })
  const entries: ZipEntryInfo[] = []
  let uncompressedSize = 0
  let compressedSize = 0

  zip.forEach((relativePath, file) => {
    if (!relativePath) return
    // Prefer trailing-slash dirs from the archive itself.
    const isDirectory = file.dir || relativePath.endsWith('/')
    const name = basename(relativePath.replace(/\/+$/, '')) || relativePath
    // JSZip exposes sizes on the internal dir entry when present.
    const data = (file as unknown as { _data?: { uncompressedSize?: number; compressedSize?: number } })
      ._data
    const uncomp = isDirectory ? 0 : Number(data?.uncompressedSize ?? 0)
    const comp = isDirectory ? 0 : Number(data?.compressedSize ?? 0)
    uncompressedSize += uncomp
    compressedSize += comp
    entries.push({
      path: isDirectory && !relativePath.endsWith('/') ? `${relativePath}/` : relativePath,
      name: isDirectory && !name.endsWith('/') ? `${name}/` : name,
      isDirectory,
      compressedSize: comp,
      uncompressedSize: uncomp,
      modifiedAt: file.date ? file.date.getTime() : undefined
    })
  })

  // Sort paths so tree rendering is stable (dirs + files by path).
  entries.sort((a, b) => a.path.localeCompare(b.path))
  // Prefer archive file size when compressed totals are incomplete.
  if (compressedSize <= 0) compressedSize = fileSize
  const ratio =
    uncompressedSize > 0
      ? Math.max(0, Math.min(100, Math.round((1 - compressedSize / uncompressedSize) * 100)))
      : 0
  return {
    entries,
    entryCount: entries.filter((e) => !e.isDirectory).length || entries.length,
    compressedSize,
    uncompressedSize,
    ratio
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
