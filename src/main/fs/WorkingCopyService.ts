import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, realpathSync, watch, type FSWatcher } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/**
 * Document sandbox — single source of truth for Save / Discard.
 *
 * ## Contract (invariants)
 *
 * | Store        | Role                                                                 |
 * |--------------|----------------------------------------------------------------------|
 * | **real**     | User’s original path. Written **only** by {@link promote}.           |
 * | **working**  | Sandbox file under userData. All agent/tool/preview I/O goes here.   |
 *
 * - {@link ensure}: create working = clone(real) if missing; never wipe an
 *   existing working that may hold edits.
 * - {@link promote}: working → real (atomic). Then mark clean.
 * - {@link discard}: delete working, re-clone from **real** (real untouched).
 * - {@link ioPath}: real → working when sandboxed; otherwise identity.
 * - {@link rewriteCommand}: shell commands that mention real get working path.
 *
 * Dirty ⇔ working content differs from the clean watermark (size+mtime set at
 * seed / after promote). Real is never used as the dirty signal.
 */

export type WorkingCopyStatus = {
  realPath: string
  copyPath: string
  dirty: boolean
  active: true
}

type Entry = {
  /** Canonical absolute path of the user’s file. */
  realPath: string
  /** Directory key under working-copies/. */
  key: string
  copyPath: string
  /** Watermark of working right after seed or promote. */
  cleanSize: number
  cleanMtimeMs: number
  dirty: boolean
  refCount: number
  /** Extra aliases that map to this entry (non-realpath forms). */
  aliases: Set<string>
  /** Last copy identity we told the UI about (`size:mtime`). */
  lastNotifiedSig?: string
  watcher?: FSWatcher
  watchTimer?: ReturnType<typeof setTimeout>
}

type PersistIndex = Record<
  string,
  { key: string; realPath: string; copyName: string }
>

function stripSlash(path: string): string {
  return path.replace(/\/+$/, '') || path
}

/** Best-effort canonical path; falls back to stripped input. */
function canonicalPath(path: string): string {
  const trimmed = stripSlash(path)
  try {
    if (existsSync(trimmed)) return realpathSync(trimmed)
  } catch {
    // keep trimmed
  }
  return trimmed
}

function keyFor(realPath: string, fileId?: string | null): string {
  if (fileId && fileId.trim()) {
    return fileId.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64)
  }
  return createHash('sha1').update(canonicalPath(realPath)).digest('hex').slice(0, 16)
}

export class WorkingCopyService {
  private readonly root = join(app.getPath('userData'), 'working-copies')
  private readonly indexPath = join(this.root, 'index.json')
  private byReal = new Map<string, Entry>()
  private byCopy = new Map<string, Entry>()
  /** Preview refresh: fired with the user-visible real path after a copy write. */
  onCopyChanged: ((realPath: string) => void) | null = null

  get storageRoot(): string {
    return this.root
  }

  // ---------------------------------------------------------------------------
  // Path mapping
  // ---------------------------------------------------------------------------

  /**
   * Filesystem path for read/write of a logical path.
   * Registered reals → working copy; untracked paths pass through.
   */
  ioPath(path: string): string {
    const entry = this.entryFor(path)
    if (entry) return entry.copyPath
    return path
  }

  /** Working/copy path → user-visible real path. */
  logicalPath(path: string): string {
    const entry = this.entryFor(path)
    if (entry) return entry.realPath
    return path
  }

  isTracked(path: string): boolean {
    return !!this.entryFor(path)
  }

  status(realPath: string): WorkingCopyStatus | null {
    const entry = this.entryFor(realPath)
    if (!entry) return null
    return {
      realPath: entry.realPath,
      copyPath: entry.copyPath,
      dirty: entry.dirty,
      active: true
    }
  }

  listActive(): WorkingCopyStatus[] {
    const seen = new Set<Entry>()
    const out: WorkingCopyStatus[] = []
    for (const e of this.byReal.values()) {
      if (seen.has(e)) continue
      seen.add(e)
      out.push({
        realPath: e.realPath,
        copyPath: e.copyPath,
        dirty: e.dirty,
        active: true
      })
    }
    return out
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Attach or create a working copy for `realPath`.
   * Existing working files are never overwritten (preserves unsaved edits).
   */
  async ensure(
    realPath: string,
    opts?: { fileId?: string | null; hold?: boolean }
  ): Promise<WorkingCopyStatus> {
    const input = stripSlash(realPath)
    if (!input) throw new Error('empty path')
    const real = canonicalPath(input)

    let entry = this.entryFor(real) ?? this.entryFor(input)
    if (entry) {
      entry.aliases.add(input)
      entry.aliases.add(real)
      this.byReal.set(input, entry)
      this.byReal.set(real, entry)
      if (opts?.hold !== false) entry.refCount += 1
      await this.refreshDirtyFlag(entry)
      return this.toStatus(entry)
    }

    const recovered = await this.tryRecover(real, input, opts?.fileId)
    if (recovered) {
      if (opts?.hold !== false) recovered.refCount += 1
      await this.refreshDirtyFlag(recovered)
      return this.toStatus(recovered)
    }

    const key = keyFor(real, opts?.fileId)
    const dir = join(this.root, key)
    await mkdir(dir, { recursive: true })
    const copyPath = join(dir, basename(real) || 'file')

    let seededFresh = false
    if (!existsSync(copyPath)) {
      await this.seedFromReal(real, copyPath)
      seededFresh = true
    }

    const st = await stat(copyPath)
    entry = {
      realPath: real,
      key,
      copyPath,
      cleanSize: seededFresh ? st.size : -1,
      cleanMtimeMs: seededFresh ? st.mtimeMs : -1,
      dirty: !seededFresh,
      refCount: opts?.hold === false ? 0 : 1,
      aliases: new Set([real, input])
    }
    if (!seededFresh) {
      // Existing on-disk working: dirty if it differs from real.
      try {
        const realSt = await stat(real)
        const same =
          realSt.size === st.size && Math.abs(realSt.mtimeMs - st.mtimeMs) <= 1000
        if (same) {
          entry.cleanSize = st.size
          entry.cleanMtimeMs = st.mtimeMs
          entry.dirty = false
        } else {
          entry.dirty = true
          entry.cleanSize = -1
          entry.cleanMtimeMs = -1
        }
      } catch {
        entry.dirty = true
      }
    }

    this.register(entry)
    await this.persistIndex()
    console.log('[working-copy] ensure', {
      real,
      copyPath,
      key,
      seededFresh,
      dirty: entry.dirty
    })
    return this.toStatus(entry)
  }

  /** After any successful write into the working copy. */
  markDirtyFromWrite(path: string): void {
    const entry = this.entryFor(path)
    if (!entry) return
    entry.dirty = true
  }

  async refreshDirty(realPath: string): Promise<boolean> {
    const entry = this.entryFor(realPath)
    if (!entry) return false
    await this.refreshDirtyFlag(entry)
    return entry.dirty
  }

  /**
   * working → real. Only writer of the user’s original path in the sandbox model.
   */
  async promote(realPath: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const input = stripSlash(realPath)
    let entry = this.entryFor(input)
    if (!entry) {
      entry = (await this.tryRecover(canonicalPath(input), input)) ?? undefined
    }
    if (!entry) {
      console.warn('[working-copy] promote: no working copy', realPath)
      return { ok: false, error: 'No working copy for this path' }
    }
    try {
      await this.refreshDirtyFlag(entry)
      const copySt = await stat(entry.copyPath)
      console.log('[working-copy] promote', {
        real: entry.realPath,
        copy: entry.copyPath,
        dirty: entry.dirty,
        bytes: copySt.size
      })
      await this.copyAtomic(entry.copyPath, entry.realPath)
      // Watermark = working after successful promote (matches real).
      const st = await stat(entry.copyPath)
      entry.cleanSize = st.size
      entry.cleanMtimeMs = st.mtimeMs
      entry.dirty = false
      await this.persistIndex()
      return { ok: true }
    } catch (err) {
      console.warn('[working-copy] promote failed', realPath, err)
      return { ok: false, error: (err as Error).message }
    }
  }

  /**
   * Drop working edits: delete sandbox, re-clone from **real** (real untouched).
   */
  async discard(
    realPath: string,
    opts?: { reseed?: boolean }
  ): Promise<{ ok: true; copyPath?: string } | { ok: false; error: string }> {
    const input = stripSlash(realPath)
    let entry = this.entryFor(input)
    if (!entry) {
      entry = (await this.tryRecover(canonicalPath(input), input)) ?? undefined
    }
    if (!entry) {
      // Nothing sandboxed — real is already the only store.
      return { ok: true }
    }
    const key = entry.key
    const real = entry.realPath
    try {
      this.unregister(entry)
      await rm(dirname(entry.copyPath), { recursive: true, force: true })
      await this.persistIndex()
      if (opts?.reseed === false) return { ok: true }

      // Fresh working = exact clone of real (discarded edits gone).
      const next = await this.ensure(real, { fileId: key, hold: false })
      console.log('[working-copy] discard+reseed', { real, copy: next.copyPath })
      return { ok: true, copyPath: next.copyPath }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  async release(realPath: string): Promise<void> {
    const entry = this.entryFor(realPath)
    if (!entry) return
    entry.refCount = Math.max(0, entry.refCount - 1)
    if (entry.refCount === 0 && !entry.dirty) {
      await this.discard(entry.realPath, { reseed: false })
    }
  }

  /**
   * Rewrite absolute real paths of active sandboxes to working paths in a
   * shell command (officecli / python must hit the sandbox).
   */
  rewriteCommand(command: string): string {
    if (!command || this.byReal.size === 0) return command
    const seen = new Set<Entry>()
    const entries: Entry[] = []
    for (const e of this.byReal.values()) {
      if (seen.has(e)) continue
      seen.add(e)
      entries.push(e)
    }
    entries.sort((a, b) => b.realPath.length - a.realPath.length)
    let out = command
    for (const entry of entries) {
      const forms = new Set<string>([entry.realPath, ...entry.aliases])
      for (const form of forms) {
        if (form && out.includes(form)) {
          out = out.split(form).join(entry.copyPath)
        }
      }
    }
    if (out !== command) {
      console.log('[working-copy] rewrote terminal command → sandbox paths')
    }
    return out
  }

  async scanDirtiedCopies(): Promise<string[]> {
    const dirtied: string[] = []
    const seen = new Set<Entry>()
    for (const entry of this.byReal.values()) {
      if (seen.has(entry)) continue
      seen.add(entry)
      await this.refreshDirtyFlag(entry)
      if (await this.noteCopyIdentityIfChanged(entry)) dirtied.push(entry.realPath)
    }
    return dirtied
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private toStatus(entry: Entry): WorkingCopyStatus {
    return {
      realPath: entry.realPath,
      copyPath: entry.copyPath,
      dirty: entry.dirty,
      active: true
    }
  }

  private entryFor(path: string): Entry | undefined {
    const raw = stripSlash(path)
    const canon = canonicalPath(raw)
    return (
      this.byReal.get(canon) ??
      this.byReal.get(raw) ??
      this.byCopy.get(canon) ??
      this.byCopy.get(raw) ??
      this.byCopy.get(normalizeCopy(path))
    )
  }

  private register(entry: Entry): void {
    this.byReal.set(entry.realPath, entry)
    for (const a of entry.aliases) this.byReal.set(a, entry)
    this.byCopy.set(entry.copyPath, entry)
    this.byCopy.set(canonicalPath(entry.copyPath), entry)
    this.armCopyWatch(entry)
  }

  private unregister(entry: Entry): void {
    this.disarmCopyWatch(entry)
    this.byReal.delete(entry.realPath)
    for (const a of entry.aliases) this.byReal.delete(a)
    this.byCopy.delete(entry.copyPath)
    this.byCopy.delete(canonicalPath(entry.copyPath))
  }

  private armCopyWatch(entry: Entry): void {
    this.disarmCopyWatch(entry)
    // Watch the copy's unique directory so atomic replace (temp + rename)
    // still notifies — fs.watch on the file inode is dropped by that pattern.
    const dir = dirname(entry.copyPath)
    try {
      entry.watcher = watch(dir, () => {
        if (entry.watchTimer) clearTimeout(entry.watchTimer)
        entry.watchTimer = setTimeout(() => {
          entry.watchTimer = undefined
          void this.refreshDirtyFlag(entry).then(async () => {
            if (await this.noteCopyIdentityIfChanged(entry)) {
              this.onCopyChanged?.(entry.realPath)
            }
          })
        }, 120)
      })
      entry.watcher.on('error', () => this.disarmCopyWatch(entry))
    } catch {
      // Copy may not exist yet; I/O still works via ensure.
    }
  }

  private disarmCopyWatch(entry: Entry): void {
    if (entry.watchTimer) {
      clearTimeout(entry.watchTimer)
      entry.watchTimer = undefined
    }
    if (entry.watcher) {
      try {
        entry.watcher.close()
      } catch {
        // ignore
      }
      entry.watcher = undefined
    }
  }

  /** True when the working copy bytes changed since the last UI notify. */
  private async noteCopyIdentityIfChanged(entry: Entry): Promise<boolean> {
    if (!entry.dirty) return false
    try {
      const st = await stat(entry.copyPath)
      const sig = `${st.size}:${Math.round(st.mtimeMs)}`
      if (sig === entry.lastNotifiedSig) return false
      entry.lastNotifiedSig = sig
      return true
    } catch {
      return false
    }
  }

  private async seedFromReal(real: string, copyPath: string): Promise<void> {
    try {
      await copyFile(real, copyPath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await writeFile(copyPath, Buffer.alloc(0))
      } else {
        throw err
      }
    }
  }

  private async tryRecover(
    real: string,
    input: string,
    fileId?: string | null
  ): Promise<Entry | undefined> {
    const candidates = new Set<string>()
    candidates.add(keyFor(real, fileId))
    candidates.add(keyFor(real, null))
    try {
      const raw = await readFile(this.indexPath, 'utf8')
      const index = JSON.parse(raw) as PersistIndex
      for (const [k, v] of Object.entries(index)) {
        if (canonicalPath(k) === real || canonicalPath(v.realPath) === real) {
          candidates.add(v.key)
        }
      }
    } catch {
      // no index
    }

    for (const key of candidates) {
      const copyPath = join(this.root, key, basename(real) || 'file')
      try {
        const st = await stat(copyPath)
        if (!st.isFile()) continue
        let dirty = true
        let cleanSize = -1
        let cleanMtimeMs = -1
        try {
          const realSt = await stat(real)
          const same =
            realSt.size === st.size && Math.abs(realSt.mtimeMs - st.mtimeMs) <= 1000
          if (same) {
            dirty = false
            cleanSize = st.size
            cleanMtimeMs = st.mtimeMs
          }
        } catch {
          dirty = true
        }
        const entry: Entry = {
          realPath: real,
          key,
          copyPath,
          cleanSize,
          cleanMtimeMs,
          dirty,
          refCount: 0,
          aliases: new Set([real, input])
        }
        this.register(entry)
        console.log('[working-copy] recovered', { real, copyPath, dirty })
        return entry
      } catch {
        // next key
      }
    }
    return undefined
  }

  private async persistIndex(): Promise<void> {
    try {
      await mkdir(this.root, { recursive: true })
      const index: PersistIndex = {}
      const seen = new Set<Entry>()
      for (const entry of this.byReal.values()) {
        if (seen.has(entry)) continue
        seen.add(entry)
        index[entry.realPath] = {
          key: entry.key,
          realPath: entry.realPath,
          copyName: basename(entry.copyPath)
        }
      }
      await writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf8')
    } catch (err) {
      console.warn('[working-copy] persist index failed', err)
    }
  }

  private async refreshDirtyFlag(entry: Entry): Promise<void> {
    try {
      const st = await stat(entry.copyPath)
      if (entry.cleanSize < 0 || entry.cleanMtimeMs < 0) {
        entry.dirty = true
        return
      }
      if (
        st.size !== entry.cleanSize ||
        Math.abs(st.mtimeMs - entry.cleanMtimeMs) > 0.5
      ) {
        entry.dirty = true
      } else {
        entry.dirty = false
      }
    } catch {
      entry.dirty = true
    }
  }

  private async copyAtomic(from: string, to: string): Promise<void> {
    await mkdir(dirname(to), { recursive: true })
    const tmp = `${to}.vav-promote-${process.pid}-${Date.now()}.tmp`
    try {
      await copyFile(from, tmp)
      await rename(tmp, to)
    } catch {
      try {
        await rm(tmp, { force: true })
      } catch {
        // ignore
      }
      const buf = await readFile(from)
      await writeFile(to, buf)
    }
  }
}

function normalizeCopy(path: string): string {
  return stripSlash(path)
}
