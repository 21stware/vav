/**
 * Primitive filesystem on a workspace host.
 *
 * FileService, ACP `fs/*`, and the built-in agent's fs_* tools all go through
 * this surface so a later remote implementation can sit behind the same
 * interface. Reveal / Quick Look / Open With on a remote host spawn the
 * equivalent on that machine (see `hostShell`).
 */

import { watch, type FSWatcher } from 'node:fs'
import { access, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'

export type HostStat = {
  size: number
  mtimeMs: number
  birthtimeMs: number
  ctimeMs: number
  mode?: number
  uid?: number
  gid?: number
  ino?: number | bigint
  birthtime?: Date
  mtime?: Date
  isDirectory(): boolean
  isFile(): boolean
}

export type HostDirent = {
  name: string
  isDirectory(): boolean
  isFile(): boolean
}

export type HostFileHandle = {
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesRead: number }>
  close(): Promise<void>
}

export type HostWatchListener = (event: string, filename: string | Buffer | null) => void

export type HostWatcher = {
  on(event: 'error', listener: (err: Error) => void): void
  close(): void
}

export interface HostFs {
  readdir(path: string): Promise<HostDirent[]>
  stat(path: string): Promise<HostStat>
  readFile(path: string): Promise<Buffer>
  writeFile(path: string, data: string | Uint8Array, encoding?: BufferEncoding): Promise<void>
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>
  rename(from: string, to: string): Promise<void>
  open(path: string, flags: string): Promise<HostFileHandle>
  watch(path: string, opts: { recursive?: boolean }, listener: HostWatchListener): HostWatcher
  exists(path: string): Promise<boolean>
  unlink(path: string): Promise<void>
}

export function createLocalHostFs(): HostFs {
  return {
    async readdir(path) {
      const dirents = await readdir(path, { withFileTypes: true })
      return dirents.map((d) => ({
        name: d.name,
        isDirectory: () => d.isDirectory(),
        isFile: () => d.isFile()
      }))
    },
    async stat(path) {
      const info = await stat(path)
      return {
        size: info.size,
        mtimeMs: info.mtimeMs,
        birthtimeMs: info.birthtimeMs,
        ctimeMs: info.ctimeMs,
        mode: info.mode,
        uid: info.uid,
        gid: info.gid,
        ino: info.ino,
        birthtime: info.birthtime,
        mtime: info.mtime,
        isDirectory: () => info.isDirectory(),
        isFile: () => info.isFile()
      }
    },
    readFile(path) {
      return readFile(path)
    },
    async writeFile(path, data, encoding) {
      if (typeof data === 'string') await writeFile(path, data, encoding ?? 'utf8')
      else await writeFile(path, data)
    },
    async mkdir(path, opts) {
      await mkdir(path, { recursive: opts?.recursive ?? false })
    },
    rename,
    async open(path, flags) {
      const fh = await open(path, flags)
      return {
        read: (buffer, offset, length, position) => fh.read(buffer, offset, length, position),
        close: () => fh.close()
      }
    },
    watch(path, opts, listener) {
      const watcher: FSWatcher = watch(path, opts, listener)
      return {
        on(event, cb) {
          if (event === 'error') watcher.on('error', cb)
        },
        close: () => watcher.close()
      }
    },
    async exists(path) {
      try {
        await access(path)
        return true
      } catch {
        return false
      }
    },
    async unlink(path) {
      await rm(path, { recursive: true, force: true })
    }
  }
}

export const localHostFs = createLocalHostFs()
