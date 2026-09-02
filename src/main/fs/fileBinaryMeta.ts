/**
 * Binary inspect metadata: owner, timestamps, inode — kept off FileService
 * so the heuristics can be unit-tested without Electron.
 */

import type { BinaryFileMeta } from '../../shared/ipc.ts'
import { modeToPermissions } from './fileMode.ts'

export function statTimeMs(ms?: number, date?: Date): number | null {
  if (typeof ms === 'number' && Number.isFinite(ms)) return ms
  if (date instanceof Date) return date.getTime()
  return null
}

export function inodeLabel(ino: number | bigint | null | undefined): string {
  return ino === undefined || ino === null ? '—' : String(ino)
}

export function ownerLabel(
  uid: number,
  self?: { uid: number; username: string } | null
): string {
  if (uid < 0) return '—'
  if (self && self.uid === uid) return self.username
  return String(uid)
}

export type BinaryMetaStat = {
  mode?: number
  uid?: number
  ino?: number | bigint
  birthtimeMs?: number
  mtimeMs?: number
  birthtime?: Date
  mtime?: Date
}

/** POSIX owner/times/inode plus caller-supplied UTI and default app. */
export function assembleBinaryMeta(
  info: BinaryMetaStat,
  opts: {
    self: { uid: number; username: string } | null
    uti: string
    defaultApp: string | null
  }
): BinaryFileMeta {
  const mode = typeof info.mode === 'number' ? info.mode : 0
  const uid = typeof info.uid === 'number' ? info.uid : -1
  return {
    uti: opts.uti,
    permissions: mode ? modeToPermissions(mode) : '—',
    owner: ownerLabel(uid, opts.self),
    createdAt: statTimeMs(info.birthtimeMs, info.birthtime),
    modifiedAt: statTimeMs(info.mtimeMs, info.mtime),
    inode: inodeLabel(info.ino),
    defaultApp: opts.defaultApp
  }
}

export type TriedBinaryMeta =
  | { ok: true; binaryMeta: BinaryFileMeta }
  | { ok: false; error: string }

/** Catch I/O around binary-meta assembly so inspect can keep a fallback panel. */
export async function tryBinaryMeta(
  build: () => Promise<BinaryFileMeta>
): Promise<TriedBinaryMeta> {
  try {
    return { ok: true, binaryMeta: await build() }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
