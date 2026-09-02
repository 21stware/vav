import { shell } from 'electron'
import { join, dirname, basename, extname } from 'node:path'
import { spawn } from 'node:child_process'
import { userInfo } from 'node:os'
import type {
  BinaryFileMeta,
  FileInspectResult,
  SqliteQueryResult,
  TextWindowResult
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
import { localHostFs, type HostFs, type HostWatcher } from '../host'
import { conversationIdForWatchedPath } from './conversationPath'
import { isPathAllowed } from './pathAllow'
import { previewKind, mimeFor } from './filePreviewKind'
import { sortEntries, capVisibleEntries, directoryFileEntry, directoryListingError } from './fileEntrySort'
import { modeToPermissions } from './fileMode'
import { isInvalidRenameName, joinOnHostPath } from './fileHostPath'
import {
  binaryWindowCaughtError,
  binaryWindowSuccess,
  binaryProbeTextWindow,
  deniedBinaryWindow,
  deniedTextWindow,
  directoryBinaryWindow,
  directoryTextWindow,
  emptyPastEndBinaryWindow,
  emptyPastEndTextWindow,
  textWindowCaughtError,
  textWindowLooksBinary,
  textWindowSuccess,
  type BinaryWindowResult
} from './fileWindowShape'
import { mimeHintToUti } from './fileUti'
import { inspectZipArchive, zipInspectFailure, zipInspectSuccess } from './fileZipArchive'
import { looksLikeTextFile } from './fileTextSample'
import { defaultAppDisplayName, mdlsRaw } from './fileMacMeta'
import { inodeLabel, ownerLabel, statTimeMs } from './fileBinaryMeta'
import {
  binaryInspectFallback,
  deniedInspectResult,
  directoryInspectResult,
  heicInspectResult,
  inspectCaughtError,
  inspectErrorOnBase,
  inspectFileBase,
  legacyBinaryInspect,
  officeFirstPaintInspect,
  remappedConvertedInspect,
  sqliteInspectResult,
  sqliteQueryFailure,
  structuredInspectIsPartial,
  structuredInspectReject,
  textWindowInspectResult
} from './fileInspectShape'
import {
  BINARY_BASE64_SOFT,
  BINARY_WINDOW_HARD_MAX,
  INDEX_AFTER_OPEN_MS,
  STRUCTURED_FIRST_BLOCKS,
  STRUCTURED_FIRST_ROWS,
  STRUCTURED_PARSE_SOFT,
  TEXT_WINDOW_BYTES,
  TEXT_WINDOW_BYTES_AGENT,
  TEXT_WINDOW_HARD_MAX,
  WATCH_DEBOUNCE_MS,
  clampByteWindow,
  caughtIoError,
  officeUtf8WriteError,
  readBinaryStatReject,
  readBinarySuccess,
  textFileFromWindow
} from './fileWindows'

/**
 * Filesystem access for both the Files panel and the agent's fs_* tools.
 *
 * All enumeration is async and happens in the main process, so a large
 * directory can never stall the renderer (README §8: no main-thread directory
 * enumeration).
 */
export class FileService {
  private watchers = new Map<string, HostWatcher>()
  private roots = new Map<string, string>()
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
  /** Extra dirs always readable (clips, office convert sidecars, working copies). */
  private extraRoots = new Set<string>()
  /** Files / folders opened through a main-process dialog or Dock drop. */
  private grantedPaths = new Set<string>()

  constructor(
    private onDirtyDirectories: (conversationId: string, dirs: string[]) => void,
    private readonly fs: HostFs = localHostFs,
    /** Per-conversation host. Missing / unknown machines use {@link fs}. */
    private readonly resolveFs?: (conversationId: string) => HostFs
  ) {}

  grantRoot(root: string): void {
    const trimmed = root.trim()
    if (trimmed) this.extraRoots.add(trimmed)
  }

  grantPath(path: string): void {
    const trimmed = path.trim()
    if (trimmed) this.grantedPaths.add(trimmed)
  }

  /**
   * When a workspace is watched, IPC may only touch that tree, app-managed
   * temp dirs, and paths granted by a native open/save dialog.
   * Before any workspace is watched, allow (open-file / tests).
   */
  isAllowedPath(path: string): boolean {
    if (!path || path.includes('\0')) return false
    const roots = [...this.roots.values(), ...this.extraRoots]
    if (isPathAllowed(path, roots, this.grantedPaths)) return true
    return this.roots.size === 0
  }

  private accessError(path: string): string | null {
    return this.isAllowedPath(path) ? null : t('files.error.notAllowed')
  }

  private fsFor(conversationId?: string | null, path?: string): HostFs {
    const id = conversationIdForWatchedPath(this.roots, path ?? '', conversationId)
    if (!id || !this.resolveFs) return this.fs
    try {
      return this.resolveFs(id)
    } catch {
      return this.fs
    }
  }

  /** Conversation whose watched root contains `path` (git / preview fallback). */
  conversationIdForPath(path: string): string | undefined {
    return conversationIdForWatchedPath(this.roots, path)
  }

  /** Filesystem path for read/write (may be a working copy). */
  private forIo(path: string, conversationId?: string | null): string {
    const hostFs = this.fsFor(conversationId, path)
    if (hostFs !== this.fs) return path
    return this.workingCopies?.ioPath(path) ?? path
  }

  /** Notify the sandbox that a write landed on this logical path. */
  private noteWrite(logicalPath: string): void {
    this.workingCopies?.markDirtyFromWrite(logicalPath)
  }

  /** Loads exactly one level; callers expand lazily as the user opens folders. */
  async listDirectory(
    path: string,
    sort: FileSortKey = 'name',
    ascending = true,
    conversationId?: string
  ): Promise<DirectoryListing> {
    const denied = this.accessError(path)
    if (denied) return directoryListingError(path, denied)
    const hostFs = this.fsFor(conversationId, path)
    try {
      const dirents = await hostFs.readdir(path)
      const visible = dirents.filter((d) => !isIgnoredName(d.name))
      const { slice, truncated } = capVisibleEntries(visible, DIRECTORY_ENTRY_CAP)

      const entries = await Promise.all(
        slice.map(async (dirent): Promise<FileEntry> => {
          const full = joinOnHostPath(path, dirent.name)
          let size = 0
          let modifiedAt = 0
          let createdAt = 0
          try {
            const info = await hostFs.stat(full)
            size = info.size
            modifiedAt = info.mtimeMs
            createdAt = info.birthtimeMs || info.ctimeMs || info.mtimeMs
          } catch {
            // Broken symlink or a race with an external delete; show it as empty.
          }
          return directoryFileEntry({
            path: full,
            name: dirent.name,
            isDirectory: dirent.isDirectory(),
            size,
            modifiedAt,
            createdAt
          })
        })
      )

      return { path, entries: sortEntries(entries, sort, ascending), truncated }
    } catch (err) {
      return directoryListingError(path, (err as Error).message)
    }
  }

  async readTextFile(
    path: string,
    conversationId?: string
  ): Promise<{ content: string; truncated: boolean; error?: string }> {
    const win = await this.readTextWindow(path, {
      startByte: 0,
      maxBytes: TEXT_WINDOW_BYTES_AGENT,
      conversationId
    })
    return textFileFromWindow(win)
  }

  /**
   * Byte-window UTF-8 read. Does not load the whole file into memory.
   * `maxBytes` is a technical payload size, not a product refusal.
   * Pass `force: true` to open known-binary files as text (null bytes allowed).
   */
  async readTextWindow(
    path: string,
    opts?: { startByte?: number; maxBytes?: number; force?: boolean; conversationId?: string }
  ): Promise<TextWindowResult> {
    const { startByte, maxBytes } = clampByteWindow(
      opts?.startByte,
      opts?.maxBytes,
      TEXT_WINDOW_BYTES,
      TEXT_WINDOW_HARD_MAX
    )
    const force = !!opts?.force
    const denied = this.accessError(path)
    if (denied) return deniedTextWindow(startByte, denied)
    const hostFs = this.fsFor(opts?.conversationId, path)
    const io = this.forIo(path, opts?.conversationId)
    try {
      const info = await hostFs.stat(io)
      if (info.isDirectory()) {
        return directoryTextWindow(t('files.error.directory'))
      }
      const totalBytes = info.size
      if (startByte >= totalBytes) {
        return emptyPastEndTextWindow(startByte, totalBytes)
      }
      const length = Math.min(maxBytes, totalBytes - startByte)
      const fh = await hostFs.open(io, 'r')
      try {
        const buf = Buffer.alloc(length)
        const { bytesRead } = await fh.read(buf, 0, length, startByte)
        const slice = buf.subarray(0, bytesRead)
        // Null byte in the first window → treat as binary (unless mid-file
        // continuation, or the caller forced a text/hex override).
        if (textWindowLooksBinary(force, startByte, slice.includes(0))) {
          return binaryProbeTextWindow(startByte, totalBytes, t('files.error.binary'))
        }
        return textWindowSuccess(slice.toString('utf8'), startByte, bytesRead, totalBytes)
      } finally {
        await fh.close()
      }
    } catch (err) {
      return textWindowCaughtError(startByte, err)
    }
  }

  /**
   * Byte-window raw read for hex dump (base64 payload). Same soft window
   * budget as text — not a product size gate.
   */
  async readBinaryWindow(
    path: string,
    opts?: { startByte?: number; maxBytes?: number; conversationId?: string }
  ): Promise<BinaryWindowResult> {
    const { startByte, maxBytes } = clampByteWindow(
      opts?.startByte,
      opts?.maxBytes,
      TEXT_WINDOW_BYTES,
      BINARY_WINDOW_HARD_MAX
    )
    const denied = this.accessError(path)
    if (denied) return deniedBinaryWindow(startByte, denied)
    const hostFs = this.fsFor(opts?.conversationId, path)
    const io = this.forIo(path, opts?.conversationId)
    try {
      const info = await hostFs.stat(io)
      if (info.isDirectory()) {
        return directoryBinaryWindow(t('files.error.directory'))
      }
      const totalBytes = info.size
      if (startByte >= totalBytes) {
        return emptyPastEndBinaryWindow(startByte, totalBytes)
      }
      const length = Math.min(maxBytes, totalBytes - startByte)
      const fh = await hostFs.open(io, 'r')
      try {
        const buf = Buffer.alloc(length)
        const { bytesRead } = await fh.read(buf, 0, length, startByte)
        const slice = buf.subarray(0, bytesRead)
        return binaryWindowSuccess(slice.toString('base64'), startByte, bytesRead, totalBytes)
      } finally {
        await fh.close()
      }
    } catch (err) {
      return binaryWindowCaughtError(startByte, err)
    }
  }

  async writeTextFile(
    path: string,
    content: string,
    conversationId?: string
  ): Promise<{ ok: boolean; error?: string }> {
    const denied = this.accessError(path)
    if (denied) return { ok: false, error: denied }
    try {
      // Refuse to clobber OOXML/PDF with UTF-8 text — agents must use binary-aware
      // tools (or a shell) for those formats.
      const officeError = officeUtf8WriteError(path)
      if (officeError) return { ok: false, error: officeError }
      const hostFs = this.fsFor(conversationId, path)
      const io = this.forIo(path, conversationId)
      await hostFs.mkdir(dirname(io), { recursive: true })
      await hostFs.writeFile(io, content, 'utf8')
      if (hostFs === this.fs) this.noteWrite(path)
      return { ok: true }
    } catch (err) {
      return caughtIoError(err)
    }
  }

  /**
   * Write raw bytes (base64). When a working copy is active for `path`, writes
   * the sandbox — never the real user file until {@link WorkingCopyService.promote}.
   */
  async writeBinary(
    path: string,
    base64: string,
    conversationId?: string
  ): Promise<{ ok: boolean; error?: string }> {
    const denied = this.accessError(path)
    if (denied) return { ok: false, error: denied }
    try {
      if (isOfficeLockFile(path)) {
        return { ok: false, error: OFFICE_LOCK_FILE_MESSAGE }
      }
      const hostFs = this.fsFor(conversationId, path)
      const io = this.forIo(path, conversationId)
      await hostFs.mkdir(dirname(io), { recursive: true })
      await hostFs.writeFile(io, Buffer.from(base64, 'base64'))
      if (hostFs === this.fs) this.noteWrite(path)
      return { ok: true }
    } catch (err) {
      return caughtIoError(err)
    }
  }

  /**
   * Raw bytes as base64 for client-side mature renderers (docx-preview / SheetJS).
   * Prefer `vav-local://` streaming when possible — this path is a convenience.
   * Soft memory budget may refuse base64 for huge files (use stream URL instead).
   */
  async readBinary(
    path: string,
    conversationId?: string
  ): Promise<
    { ok: true; base64: string; size: number; mime: string } | { ok: false; error: string }
  > {
    const denied = this.accessError(path)
    if (denied) return { ok: false, error: denied }
    try {
      if (isOfficeLockFile(path)) {
        return { ok: false, error: OFFICE_LOCK_FILE_MESSAGE }
      }
      const hostFs = this.fsFor(conversationId, path)
      const io = this.forIo(path, conversationId)
      const info = await hostFs.stat(io)
      const rejected = readBinaryStatReject(
        { isDirectory: info.isDirectory(), size: info.size },
        { directoryError: t('files.error.directory'), softMax: BINARY_BASE64_SOFT }
      )
      if (rejected) return rejected
      const kind = previewKind(basename(path))
      const buffer = await hostFs.readFile(io)
      return readBinarySuccess(buffer, mimeFor(basename(path), kind))
    } catch (err) {
      return caughtIoError(err)
    }
  }

  async rename(
    path: string,
    newName: string,
    conversationId?: string
  ): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    const name = newName.trim()
    if (isInvalidRenameName(name)) {
      return { ok: false, error: t('files.error.badName') }
    }
    const target = join(dirname(path), name)
    const denied = this.accessError(path) || this.accessError(target)
    if (denied) return { ok: false, error: denied }
    try {
      await this.fsFor(conversationId, path).rename(path, target)
      return { ok: true, path: target }
    } catch (err) {
      return caughtIoError(err)
    }
  }

  async trash(
    paths: string[],
    conversationId?: string
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    for (const path of paths) {
      const denied = this.accessError(path)
      if (denied) return { ok: false, error: denied }
    }
    try {
      for (const path of paths) {
        const hostFs = this.fsFor(conversationId, path)
        if (hostFs !== this.fs) {
          // Remote hosts have no OS Trash — unlink on that machine.
          await hostFs.unlink(path)
        } else {
          await shell.trashItem(path)
        }
      }
      return { ok: true }
    } catch (err) {
      return caughtIoError(err)
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

  async inspect(path: string, conversationId?: string): Promise<FileInspectResult> {
    const name = basename(path)
    const denied = this.accessError(path)
    if (denied) {
      return deniedInspectResult(path, name, denied)
    }
    // Sandbox: I/O against working copy when active; result.path stays logical.
    const hostFs = this.fsFor(conversationId, path)
    const io = this.forIo(path, conversationId)
    try {
      const info = await hostFs.stat(io)
      if (info.isDirectory()) {
        // Not a file preview — callers (Workspace) should not open FileViewer on dirs.
        // Never label folders as binary (that surfaces "Open with default app" for workdirs).
        return directoryInspectResult(path, name, info.mtimeMs)
      }

      // Legacy Office: convert on open (temp sidecar), then re-inspect modern path.
      const legacy = legacyOfficeKind(path)
      if (legacy === 'doc') {
        const converted = await convertLegacyOffice(path)
        if (converted.ok) {
          const inner = await this.inspect(converted.path)
          return remappedConvertedInspect(
            inner,
            { path, name, size: info.size, mtimeMs: info.mtimeMs },
            converted.path,
            converted.warning
          )
        }
        // Conversion failed — fall through to binary meta with the error as warning.
        try {
          const binaryMeta = await buildBinaryMeta(path, info)
          return legacyBinaryInspect({
            path,
            name,
            size: info.size,
            mtimeMs: info.mtimeMs,
            mime: 'application/msword',
            binaryMeta,
            warnings: [converted.error]
          })
        } catch {
          return legacyBinaryInspect({
            path,
            name,
            size: info.size,
            mtimeMs: info.mtimeMs,
            mime: 'application/msword',
            warnings: [converted.error]
          })
        }
      }
      if (legacy === 'ppt') {
        try {
          const binaryMeta = await buildBinaryMeta(path, info)
          return legacyBinaryInspect({
            path,
            name,
            size: info.size,
            mtimeMs: info.mtimeMs,
            mime: 'application/vnd.ms-powerpoint',
            binaryMeta,
            warnings: [
              'Legacy PowerPoint (.ppt): export to .pptx for in-app preview, or open with the system default app.'
            ]
          })
        } catch (err) {
          return legacyBinaryInspect({
            path,
            name,
            size: info.size,
            mime: 'application/vnd.ms-powerpoint',
            error: (err as Error).message
          })
        }
      }

      let kind = previewKind(name)
      if (kind === 'binary' && (await looksLikeTextFile(hostFs, path, info.size))) {
        kind = 'text'
      }
      const mime = mimeFor(name, kind)
      const base = inspectFileBase({
        path,
        name,
        size: info.size,
        mtimeMs: info.mtimeMs,
        kind,
        mime
      })

      if (kind === 'text' || kind === 'csv' || kind === 'html' || kind === 'html-clip') {
        const win = await this.readTextWindow(path, { startByte: 0, maxBytes: TEXT_WINDOW_BYTES })
        if (win.error) return { ...base, error: win.error }
        if (kind === 'csv') this.scheduleIndex(path)
        // truncated/textWindow are for silent progressive fill in the renderer —
        // never surface a product "file too large" or "load more" affordance.
        return textWindowInspectResult(base, win)
      }

      if (kind === 'image' || kind === 'audio' || kind === 'video') {
        // Stream via vav-local — never base64 the whole media file.
        if (isHeicPath(path)) {
          const heic = await prepareHeicPreview(path)
          return heicInspectResult(base, heic)
        }
        return base
      }

      if (kind === 'sqlite') {
        try {
          return sqliteInspectResult(base, inspectSqlite(path))
        } catch (err) {
          return inspectErrorOnBase(base, err, t('files.error.unsupported'))
        }
      }

      if (kind === 'zip') {
        // Structure-only tree. Large archives skip full-buffer JSZip; on failure open empty canvas.
        try {
          const zip = await inspectZipArchive(hostFs, path, info.size)
          return zipInspectSuccess(base, zip, info.size)
        } catch (err) {
          console.error('[files] zip inspect failed', path, err)
          return zipInspectFailure(base, info.size, err)
        }
      }

      if (kind === 'pdf' || kind === 'docx' || kind === 'xlsx' || kind === 'pptx') {
        const painted = officeFirstPaintInspect(base, {
          locked: isOfficeLockFile(path),
          empty: info.size <= 0,
          streamUrl: localFileStreamUrl(io),
          large: info.size > STRUCTURED_PARSE_SOFT,
          lockMessage: OFFICE_LOCK_FILE_MESSAGE
        })
        if (!painted.error) this.scheduleIndex(io)
        return painted
      }

      // Unsupported / binary: metadata panel (no content preview). Never use
      // files.error.unsupported — that red alert is reserved for real I/O failures.
      try {
        const binaryMeta = await buildBinaryMeta(path, info)
        return { ...base, binaryMeta }
      } catch (metaErr) {
        console.error('[files] binary meta failed', path, metaErr)
        return binaryInspectFallback(base, info.mtimeMs)
      }
    } catch (err) {
      return inspectCaughtError(path, name, err)
    }
  }

  /**
   * Background structured parse for block-pick / search. Supports a first
   * partial chunk (maxBlocks / maxRows) for progressive DOCX/XLSX.
   */
  async inspectStructured(
    path: string,
    opts?: { maxBlocks?: number; maxRows?: number; conversationId?: string }
  ): Promise<
    | { ok: true; structured: import('@shared/structuredDoc').StructuredDocument; partial: boolean }
    | { ok: false; error: string }
  > {
    const denied = this.accessError(path)
    if (denied) return { ok: false, error: denied }
    const hostFs = this.fsFor(opts?.conversationId, path)
    const io = this.forIo(path, opts?.conversationId)
    try {
      const info = await hostFs.stat(io)
      const rejected = structuredInspectReject({
        isFile: info.isFile(),
        locked: isOfficeLockFile(path),
        size: info.size,
        parseSoft: STRUCTURED_PARSE_SOFT,
        lockMessage: OFFICE_LOCK_FILE_MESSAGE
      })
      if (rejected) return rejected
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
      const partial = structuredInspectIsPartial(progressive, structured.warnings)
      return { ok: true, structured, partial }
    } catch (err) {
      return caughtIoError(err)
    }
  }

  /** Page through a SQLite table for the DB preview canvas. */
  dbQuery(path: string, table: string, offset?: number, limit?: number): SqliteQueryResult {
    const denied = this.accessError(path)
    if (denied) {
      return sqliteQueryFailure(offset, limit, denied)
    }
    if (!isSqlitePath(path)) {
      return sqliteQueryFailure(offset, limit, 'Not a SQLite database path')
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
    if (this.accessError(path)) return
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
    const denied = this.accessError(path)
    if (denied) return { ok: false, error: denied }
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
      return caughtIoError(err, 'Could not open file')
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
    this.roots.set(conversationId, root)
    try {
      const watcher = this.fsFor(conversationId, root).watch(root, { recursive: true }, (_event, filename) => {
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
    this.roots.delete(conversationId)
    const timer = this.debounceTimers.get(conversationId)
    if (timer) clearTimeout(timer)
    this.debounceTimers.delete(conversationId)
    this.pendingDirs.delete(conversationId)
  }

  disposeAll(): void {
    for (const id of [...this.watchers.keys()]) this.unwatch(id)
  }
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
  let self: { uid: number; username: string } | null = null
  try {
    self = userInfo()
  } catch {
    // keep numeric uid
  }
  const owner = ownerLabel(uid, self)
  const createdMs = statTimeMs(info.birthtimeMs, info.birthtime)
  const modifiedMs = statTimeMs(info.mtimeMs, info.mtime)
  const inode = inodeLabel(info.ino)

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

