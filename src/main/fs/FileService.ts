import { shell } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { readdir, rename, stat, readFile, writeFile, mkdir, open } from 'node:fs/promises'
import { join, dirname, basename, extname } from 'node:path'
import { spawn } from 'node:child_process'
import { userInfo } from 'node:os'
import JSZip from 'jszip'
import type {
  BinaryFileMeta,
  FileInspectResult,
  FilePreviewKind,
  SqliteQueryResult,
  TextWindowResult,
  ZipArchiveInfo,
  ZipEntryInfo
} from '@shared/ipc'
import { localFileStreamUrl } from '@shared/localFileUrl'
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
import { isHeicPath, prepareHeicPreview } from './heicPreview'
import { convertLegacyOffice, legacyOfficeKind } from './legacyOfficeConvert'
import type { WorkingCopyService } from './WorkingCopyService'

/**
 * Technical windows — memory budgets for a single IPC/payload, NOT product
 * "file too large" limits. Larger files are opened via further windows or
 * `vav-local://` streaming.
 */
/** First paint window for UTF-8 text (progressive fill continues via readTextWindow). */
const TEXT_WINDOW_BYTES = 128 * 1024
/** Larger window for agent fs_read / full-ish first load when explicitly requested. */
const TEXT_WINDOW_BYTES_AGENT = 2 * 1024 * 1024
/** First structured office chunk for block-pick while native canvas loads. */
const STRUCTURED_FIRST_BLOCKS = 48
const STRUCTURED_FIRST_ROWS = 120
/** Soft ceiling for base64 IPC convenience (renderer should prefer vav-local stream). */
const BINARY_BASE64_SOFT = 16 * 1024 * 1024
/** Soft budget for full OOXML structured parse in main (best-effort index). */
const STRUCTURED_PARSE_SOFT = 32 * 1024 * 1024
/** Above this, skip JSZip.loadAsync of the full buffer (structure index truncated). */
const ZIP_FULL_LOAD_MAX = 64 * 1024 * 1024

const WATCH_DEBOUNCE_MS = 300
/** Keep document indexing off the main thread while a preview is opening. */
const INDEX_AFTER_OPEN_MS = 1500

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
  /**
   * Optional sandbox layer: when set, I/O for registered real paths is redirected
   * to the working copy so Save/Discard can promote or drop without touching real
   * until promote.
   */
  workingCopies: WorkingCopyService | null = null

  constructor(private onDirtyDirectories: (conversationId: string, dirs: string[]) => void) {}

  /** Filesystem path for read/write (may be a working copy). */
  private forIo(path: string): string {
    return this.workingCopies?.ioPath(path) ?? path
  }

  /** Notify the sandbox that a write landed on this logical path. */
  private noteWrite(logicalPath: string): void {
    this.workingCopies?.markDirtyFromWrite(logicalPath)
  }

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
    const win = await this.readTextWindow(path, {
      startByte: 0,
      maxBytes: TEXT_WINDOW_BYTES_AGENT
    })
    if (win.error) return { content: '', truncated: false, error: win.error }
    return { content: win.content, truncated: win.truncated }
  }

  /**
   * Byte-window UTF-8 read. Does not load the whole file into memory.
   * `maxBytes` is a technical payload size, not a product refusal.
   * Pass `force: true` to open known-binary files as text (null bytes allowed).
   */
  async readTextWindow(
    path: string,
    opts?: { startByte?: number; maxBytes?: number; force?: boolean }
  ): Promise<TextWindowResult> {
    const startByte = Math.max(0, Math.floor(opts?.startByte ?? 0))
    const maxBytes = Math.max(1024, Math.min(16 * 1024 * 1024, Math.floor(opts?.maxBytes ?? TEXT_WINDOW_BYTES)))
    const force = !!opts?.force
    const io = this.forIo(path)
    try {
      const info = await stat(io)
      if (info.isDirectory()) {
        return {
          content: '',
          startByte: 0,
          endByte: 0,
          totalBytes: 0,
          truncated: false,
          error: t('files.error.directory')
        }
      }
      const totalBytes = info.size
      if (startByte >= totalBytes) {
        return {
          content: '',
          startByte,
          endByte: startByte,
          totalBytes,
          truncated: false
        }
      }
      const length = Math.min(maxBytes, totalBytes - startByte)
      const fh = await open(io, 'r')
      try {
        const buf = Buffer.alloc(length)
        const { bytesRead } = await fh.read(buf, 0, length, startByte)
        const slice = buf.subarray(0, bytesRead)
        // Null byte in the first window → treat as binary (unless mid-file
        // continuation, or the caller forced a text/hex override).
        if (!force && startByte === 0 && slice.includes(0)) {
          return {
            content: '',
            startByte,
            endByte: startByte,
            totalBytes,
            truncated: false,
            error: t('files.error.binary')
          }
        }
        const endByte = startByte + bytesRead
        return {
          content: slice.toString('utf8'),
          startByte,
          endByte,
          totalBytes,
          truncated: endByte < totalBytes
        }
      } finally {
        await fh.close()
      }
    } catch (err) {
      return {
        content: '',
        startByte,
        endByte: startByte,
        totalBytes: 0,
        truncated: false,
        error: (err as Error).message
      }
    }
  }

  /**
   * Byte-window raw read for hex dump (base64 payload). Same soft window
   * budget as text — not a product size gate.
   */
  async readBinaryWindow(
    path: string,
    opts?: { startByte?: number; maxBytes?: number }
  ): Promise<
    | {
        ok: true
        base64: string
        startByte: number
        endByte: number
        totalBytes: number
        truncated: boolean
      }
    | { ok: false; error: string; startByte: number; endByte: number; totalBytes: number }
  > {
    const startByte = Math.max(0, Math.floor(opts?.startByte ?? 0))
    const maxBytes = Math.max(
      1024,
      Math.min(4 * 1024 * 1024, Math.floor(opts?.maxBytes ?? TEXT_WINDOW_BYTES))
    )
    const io = this.forIo(path)
    try {
      const info = await stat(io)
      if (info.isDirectory()) {
        return {
          ok: false,
          error: t('files.error.directory'),
          startByte: 0,
          endByte: 0,
          totalBytes: 0
        }
      }
      const totalBytes = info.size
      if (startByte >= totalBytes) {
        return {
          ok: true,
          base64: '',
          startByte,
          endByte: startByte,
          totalBytes,
          truncated: false
        }
      }
      const length = Math.min(maxBytes, totalBytes - startByte)
      const fh = await open(io, 'r')
      try {
        const buf = Buffer.alloc(length)
        const { bytesRead } = await fh.read(buf, 0, length, startByte)
        const slice = buf.subarray(0, bytesRead)
        const endByte = startByte + bytesRead
        return {
          ok: true,
          base64: slice.toString('base64'),
          startByte,
          endByte,
          totalBytes,
          truncated: endByte < totalBytes
        }
      } finally {
        await fh.close()
      }
    } catch (err) {
      return {
        ok: false,
        error: (err as Error).message,
        startByte,
        endByte: startByte,
        totalBytes: 0
      }
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
      const io = this.forIo(path)
      await mkdir(dirname(io), { recursive: true })
      await writeFile(io, content, 'utf8')
      this.noteWrite(path)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  /**
   * Write raw bytes (base64). When a working copy is active for `path`, writes
   * the sandbox — never the real user file until {@link WorkingCopyService.promote}.
   */
  async writeBinary(path: string, base64: string): Promise<{ ok: boolean; error?: string }> {
    try {
      if (isOfficeLockFile(path)) {
        return { ok: false, error: OFFICE_LOCK_FILE_MESSAGE }
      }
      const io = this.forIo(path)
      await mkdir(dirname(io), { recursive: true })
      await writeFile(io, Buffer.from(base64, 'base64'))
      this.noteWrite(path)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  /**
   * Raw bytes as base64 for client-side mature renderers (docx-preview / SheetJS).
   * Prefer `vav-local://` streaming when possible — this path is a convenience.
   * Soft memory budget may refuse base64 for huge files (use stream URL instead).
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
      const io = this.forIo(path)
      const info = await stat(io)
      if (info.isDirectory()) return { ok: false, error: t('files.error.directory') }
      if (info.size <= 0) return { ok: false, error: 'File is empty.' }
      if (info.size > BINARY_BASE64_SOFT) {
        return {
          ok: false,
          error: `File is ${Math.round(info.size / 1024 / 1024)} MB — use vav-local:// stream (or inspect.streamUrl) instead of base64 IPC. Base64 is a soft memory budget, not a product open limit.`
        }
      }
      const kind = previewKind(basename(path))
      const buffer = await readFile(io)
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

  /**
   * Build the retrieval index well after the preview has painted.
   *
   * Extracting text from a PDF is hundreds of milliseconds of main-process
   * work; on a 0 ms timer it lands inside the open and delays every IPC the
   * opening window is waiting on.
   */
  private scheduleIndex(path: string): void {
    if (!this.retrieval) return
    setTimeout(() => {
      void this.retrieval?.ensureIndex(path).catch(() => {})
    }, INDEX_AFTER_OPEN_MS)
  }

  async inspect(path: string): Promise<FileInspectResult> {
    const name = basename(path)
    // Sandbox: I/O against working copy when active; result.path stays logical.
    const io = this.forIo(path)
    try {
      const info = await stat(io)
      if (info.isDirectory()) {
        // Not a file preview — callers (Workspace) should not open FileViewer on dirs.
        // Never label folders as binary (that surfaces "Open with default app" for workdirs).
        return {
          path,
          name,
          size: 0,
          mtimeMs: info.mtimeMs,
          kind: 'directory',
          mime: 'inode/directory'
        }
      }

      // Legacy Office: convert on open (temp sidecar), then re-inspect modern path.
      const legacy = legacyOfficeKind(path)
      if (legacy === 'doc') {
        const converted = await convertLegacyOffice(path)
        if (converted.ok) {
          const inner = await this.inspect(converted.path)
          return {
            ...inner,
            // Keep the user-facing identity as the original path.
            path,
            name,
            size: info.size,
            mtimeMs: info.mtimeMs,
            contentPath: converted.path,
            streamUrl: localFileStreamUrl(converted.path),
            warnings: [
              ...(inner.warnings ?? []),
              ...(converted.warning ? [converted.warning] : [])
            ]
          }
        }
        // Conversion failed — fall through to binary meta with the error as warning.
        try {
          const binaryMeta = await buildBinaryMeta(path, info)
          return {
            path,
            name,
            size: info.size,
            mtimeMs: info.mtimeMs,
            kind: 'binary',
            mime: 'application/msword',
            binaryMeta,
            warnings: [converted.error]
          }
        } catch {
          return {
            path,
            name,
            size: info.size,
            mtimeMs: info.mtimeMs,
            kind: 'binary',
            mime: 'application/msword',
            warnings: [converted.error]
          }
        }
      }
      if (legacy === 'ppt') {
        try {
          const binaryMeta = await buildBinaryMeta(path, info)
          return {
            path,
            name,
            size: info.size,
            mtimeMs: info.mtimeMs,
            kind: 'binary',
            mime: 'application/vnd.ms-powerpoint',
            binaryMeta,
            warnings: [
              'Legacy PowerPoint (.ppt): export to .pptx for in-app preview, or open with the system default app.'
            ]
          }
        } catch (err) {
          return {
            path,
            name,
            size: info.size,
            kind: 'binary',
            mime: 'application/vnd.ms-powerpoint',
            error: (err as Error).message
          }
        }
      }

      let kind = previewKind(name)
      if (kind === 'binary' && (await looksLikeTextFile(path, info.size))) {
        kind = 'text'
      }
      const mime = mimeFor(name, kind)
      const base: FileInspectResult = {
        path,
        name,
        size: info.size,
        mtimeMs: info.mtimeMs,
        kind,
        mime,
        streamUrl: localFileStreamUrl(path)
      }

      if (kind === 'text' || kind === 'csv' || kind === 'html') {
        const win = await this.readTextWindow(path, { startByte: 0, maxBytes: TEXT_WINDOW_BYTES })
        if (win.error) return { ...base, error: win.error }
        if (kind === 'csv') this.scheduleIndex(path)
        // truncated/textWindow are for silent progressive fill in the renderer —
        // never surface a product "file too large" or "load more" affordance.
        return {
          ...base,
          text: win.content,
          truncated: win.truncated,
          textWindow: {
            startByte: win.startByte,
            endByte: win.endByte,
            totalBytes: win.totalBytes
          },
          lineCount: win.content ? countNewlines(win.content) : 0
        }
      }

      if (kind === 'image' || kind === 'audio' || kind === 'video') {
        // Stream via vav-local — never base64 the whole media file.
        if (isHeicPath(path)) {
          const heic = await prepareHeicPreview(path)
          return {
            ...base,
            kind: 'image',
            mime: heic.converted ? 'image/jpeg' : 'image/heic',
            contentPath: heic.converted ? heic.previewPath : undefined,
            streamUrl: localFileStreamUrl(heic.previewPath),
            imageMeta: heic.meta,
            warnings: heic.converted
              ? ['HEIC decoded to a temporary JPEG for preview (original unchanged).']
              : undefined
          }
        }
        return {
          ...base,
          streamUrl: localFileStreamUrl(path)
        }
      }

      if (kind === 'sqlite') {
        try {
          const sqlite = inspectSqlite(path)
          const summary = sqlite.tables
            .map((tb) => `${tb.name} (${tb.rowCount} rows · ${tb.columns.length} cols)`)
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
        // Structure-only tree. Large archives skip full-buffer JSZip; on failure open empty canvas.
        try {
          const zip = await inspectZipArchive(path, info.size)
          const treeText = zip.entries
            .map((e) => `${e.isDirectory ? 'D' : 'F'} ${e.path}`)
            .join('\n')
          const warnings: string[] = []
          if (zip.encrypted) {
            warnings.push(
              'This archive appears password-protected. vav lists what it can without a password and does not extract encrypted entries.'
            )
          }
          if (zip.truncated) {
            warnings.push(
              `Large ZIP (${Math.round(info.size / 1024 / 1024)} MB) — full structure index skipped to avoid loading the archive into memory.`
            )
          }
          return {
            ...base,
            zip: {
              entries: zip.entries,
              entryCount: zip.entryCount,
              compressedSize: zip.compressedSize,
              uncompressedSize: zip.uncompressedSize,
              ratio: zip.ratio
            },
            zipEncrypted: zip.encrypted,
            truncated: zip.truncated || undefined,
            text: treeText,
            lineCount: zip.entries.length,
            warnings: warnings.length ? warnings : undefined
          }
        } catch (err) {
          console.error('[files] zip inspect failed', path, err)
          const msg = (err as Error).message || ''
          const encrypted = /password|encrypt|encrypted/i.test(msg)
          return {
            ...base,
            zip: {
              entries: [],
              entryCount: 0,
              compressedSize: info.size,
              uncompressedSize: 0,
              ratio: 0
            },
            zipEncrypted: encrypted,
            truncated: true,
            text: '',
            lineCount: 0,
            warnings: [
              encrypted
                ? 'Password-protected ZIP — structure unavailable without a password (not prompted in-app).'
                : `Could not index ZIP structure: ${msg || 'unknown error'}`
            ]
          }
        }
      }

      if (kind === 'pdf' || kind === 'docx' || kind === 'xlsx' || kind === 'pptx') {
        if (isOfficeLockFile(path)) {
          return { ...base, error: OFFICE_LOCK_FILE_MESSAGE }
        }
        if (info.size <= 0) return { ...base, error: 'File is empty.' }
        // Always streamable; never refuse open on size.
        // Stream the I/O path (working copy when sandboxed).
        base.streamUrl = localFileStreamUrl(io)
        // Fast path: kind + streamUrl only. Structured parse is
        // `inspectStructured` (background) so first paint is not blocked.
        this.scheduleIndex(io)
        if (info.size > STRUCTURED_PARSE_SOFT) {
          return {
            ...base,
            warnings: [
              'Large Office document — preview opens via streaming; full text index runs in the background.'
            ]
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

  /**
   * Background structured parse for block-pick / search. Supports a first
   * partial chunk (maxBlocks / maxRows) for progressive DOCX/XLSX.
   */
  async inspectStructured(
    path: string,
    opts?: { maxBlocks?: number; maxRows?: number }
  ): Promise<
    | { ok: true; structured: import('@shared/structuredDoc').StructuredDocument; partial: boolean }
    | { ok: false; error: string }
  > {
    const io = this.forIo(path)
    try {
      const info = await stat(io)
      if (!info.isFile()) return { ok: false, error: 'Not a file' }
      if (isOfficeLockFile(path)) return { ok: false, error: OFFICE_LOCK_FILE_MESSAGE }
      if (info.size <= 0) return { ok: false, error: 'File is empty.' }
      if (info.size > STRUCTURED_PARSE_SOFT) {
        return { ok: false, error: 'Document too large for full structured index' }
      }
      const progressive = opts?.maxBlocks != null || opts?.maxRows != null
      const structured = await parseStructuredDocument(
        io,
        info.size,
        progressive
          ? {
              maxBlocks: opts?.maxBlocks ?? STRUCTURED_FIRST_BLOCKS,
              maxRows: opts?.maxRows ?? STRUCTURED_FIRST_ROWS
            }
          : undefined
      )
      const partial =
        progressive ||
        (structured.warnings ?? []).some((w) => /partial|truncated|first/i.test(w))
      return { ok: true, structured, partial }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
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
  // Diagrams / mind maps (text-encoded; .mm may also be ObjC++ — sniff on open)
  '.mmd',
  '.mermaid',
  '.dot',
  '.gv',
  '.opml',
  '.drawio',
  '.dio',
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
  if (
    [
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.webp',
      '.bmp',
      '.svg',
      '.ico',
      '.avif',
      '.heic',
      '.heif',
      '.hif',
      '.tif',
      '.tiff'
    ].includes(ext)
  ) {
    return 'image'
  }
  if (ext === '.pdf') return 'pdf'
  if (ext === '.zip') return 'zip'
  if (ext === '.docx') return 'docx'
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx'
  if (ext === '.pptx') return 'pptx'
  if (ext === '.html' || ext === '.htm' || ext === '.xhtml') return 'html'
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

/** Count lines without allocating a split array (large CSV/text inspect path). */
function countNewlines(text: string): number {
  if (!text) return 0
  let n = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) n++
  }
  // Trailing newline does not add an extra blank line for display purposes.
  if (text.charCodeAt(text.length - 1) === 10) n--
  return Math.max(n, 1)
}

/** Treat unknown extensions as text when the buffer looks like UTF-8 source. */
async function looksLikeTextFile(path: string, size: number): Promise<boolean> {
  if (size <= 0) return false
  try {
    const sampleSize = Math.min(size, 8192)
    const fh = await open(path, 'r')
    try {
      const buf = Buffer.alloc(sampleSize)
      const { bytesRead } = await fh.read(buf, 0, sampleSize, 0)
      const slice = buf.subarray(0, bytesRead)
      if (slice.includes(0)) return false
      const text = slice.toString('utf8')
      let bad = 0
      for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i)
        if (code === 0xfffd) bad += 1
        else if (code < 9 || (code > 13 && code < 32)) bad += 1
      }
      return bad / Math.max(text.length, 1) < 0.02
    } finally {
      await fh.close()
    }
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
      if (ext === '.heic' || ext === '.heif' || ext === '.hif') return 'image/heic'
      if (ext === '.tif' || ext === '.tiff') return 'image/tiff'
      if (ext === '.avif') return 'image/avif'
      if (ext === '.bmp') return 'image/bmp'
      if (ext === '.ico') return 'image/x-icon'
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
    case 'html':
      return ext === '.xhtml' ? 'application/xhtml+xml' : 'text/html'
    case 'csv':
      return 'text/csv'
    case 'sqlite':
      return 'application/vnd.sqlite3'
    case 'zip':
      return 'application/zip'
    case 'directory':
      return 'inode/directory'
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

/** Probe ZIP local-file headers for encryption without loading the whole archive. */
async function probeZipEncrypted(path: string, fileSize: number): Promise<boolean> {
  if (fileSize < 30) return false
  const sampleLen = Math.min(fileSize, 64 * 1024)
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(sampleLen)
    const { bytesRead } = await fh.read(buf, 0, sampleLen, 0)
    const buffer = buf.subarray(0, bytesRead)
    let offset = 0
    for (let i = 0; i < 8 && offset + 30 <= buffer.length; i++) {
      if (buffer.readUInt32LE(offset) !== 0x04034b50) break
      const flags = buffer.readUInt16LE(offset + 6)
      if (flags & 0x1) return true
      const nameLen = buffer.readUInt16LE(offset + 26)
      const extraLen = buffer.readUInt16LE(offset + 28)
      const compSize = buffer.readUInt32LE(offset + 18)
      offset += 30 + nameLen + extraLen + compSize
    }
    return false
  } finally {
    await fh.close()
  }
}

/** Structure-only ZIP index for the archive tree preview (no entry contents). */
async function inspectZipArchive(
  path: string,
  fileSize: number
): Promise<ZipArchiveInfo & { encrypted: boolean; truncated: boolean }> {
  // Avoid reading multi‑hundred‑MB archives into memory just to list structure.
  if (fileSize > ZIP_FULL_LOAD_MAX) {
    let encrypted = false
    try {
      encrypted = await probeZipEncrypted(path, fileSize)
    } catch {
      // Probe is best-effort; still return a truncated empty summary.
    }
    return {
      entries: [],
      entryCount: 0,
      compressedSize: fileSize,
      uncompressedSize: 0,
      ratio: 0,
      encrypted,
      truncated: true
    }
  }

  const buffer = await readFile(path)
  // Quick magic / encryption probe (general-purpose bit 0 of local file headers).
  let encrypted = false
  if (buffer.length >= 30) {
    // Scan a few local headers; encrypted archives set bit 0 of the GP flag.
    let offset = 0
    for (let i = 0; i < 8 && offset + 30 <= buffer.length; i++) {
      if (buffer.readUInt32LE(offset) !== 0x04034b50) break
      const flags = buffer.readUInt16LE(offset + 6)
      if (flags & 0x1) {
        encrypted = true
        break
      }
      const nameLen = buffer.readUInt16LE(offset + 26)
      const extraLen = buffer.readUInt16LE(offset + 28)
      const compSize = buffer.readUInt32LE(offset + 18)
      offset += 30 + nameLen + extraLen + compSize
    }
  }

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
    // JSZip options may flag encryption on the entry options object.
    const opts = (file as unknown as { options?: { encrypted?: boolean } }).options
    if (opts?.encrypted) encrypted = true
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
    ratio,
    encrypted,
    truncated: false
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
