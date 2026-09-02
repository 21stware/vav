import { basename } from 'node:path'
import JSZip from 'jszip'
import type { ZipArchiveInfo, ZipEntryInfo } from '../../shared/ipc.ts'
import type { HostFs } from '../host/HostFs.ts'
import { zipLocalHeadersEncrypted } from './fileZip.ts'

/** Above this, skip JSZip.loadAsync of the full buffer (structure index truncated). */
export const ZIP_FULL_LOAD_MAX = 64 * 1024 * 1024

export type ZipArchiveInspect = ZipArchiveInfo & { encrypted: boolean; truncated: boolean }

/** Sort, ratio, and file-entry count for a ZIP structure preview. */
export function summarizeZipArchive(
  entries: ZipEntryInfo[],
  fileSize: number,
  encrypted: boolean,
  truncated: boolean
): ZipArchiveInspect {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path))
  let uncompressedSize = 0
  let compressedSize = 0
  for (const entry of sorted) {
    uncompressedSize += entry.uncompressedSize
    compressedSize += entry.compressedSize
  }
  if (compressedSize <= 0) compressedSize = fileSize
  const ratio =
    uncompressedSize > 0
      ? Math.max(0, Math.min(100, Math.round((1 - compressedSize / uncompressedSize) * 100)))
      : 0
  return {
    entries: sorted,
    entryCount: sorted.filter((e) => !e.isDirectory).length || sorted.length,
    compressedSize,
    uncompressedSize,
    ratio,
    encrypted,
    truncated
  }
}

export function zipTreeText(entries: { isDirectory: boolean; path: string }[]): string {
  return entries.map((e) => `${e.isDirectory ? 'D' : 'F'} ${e.path}`).join('\n')
}

export function zipInspectWarnings(opts: {
  encrypted: boolean
  truncated: boolean
  fileSize: number
}): string[] {
  const warnings: string[] = []
  if (opts.encrypted) {
    warnings.push(
      'This archive appears password-protected. vav lists what it can without a password and does not extract encrypted entries.'
    )
  }
  if (opts.truncated) {
    warnings.push(
      `Large ZIP (${Math.round(opts.fileSize / 1024 / 1024)} MB) — full structure index skipped to avoid loading the archive into memory.`
    )
  }
  return warnings
}

/** Probe ZIP local-file headers for encryption without loading the whole archive. */
export async function probeZipEncrypted(fs: HostFs, path: string, fileSize: number): Promise<boolean> {
  if (fileSize < 30) return false
  const sampleLen = Math.min(fileSize, 64 * 1024)
  const fh = await fs.open(path, 'r')
  try {
    const buf = Buffer.alloc(sampleLen)
    const { bytesRead } = await fh.read(buf, 0, sampleLen, 0)
    return zipLocalHeadersEncrypted(buf.subarray(0, bytesRead))
  } finally {
    await fh.close()
  }
}

/** Structure-only ZIP index for the archive tree preview (no entry contents). */
export async function inspectZipArchive(
  fs: HostFs,
  path: string,
  fileSize: number
): Promise<ZipArchiveInspect> {
  // Avoid reading multi‑hundred‑MB archives into memory just to list structure.
  if (fileSize > ZIP_FULL_LOAD_MAX) {
    let encrypted = false
    try {
      encrypted = await probeZipEncrypted(fs, path, fileSize)
    } catch {
      // Probe is best-effort; still return a truncated empty summary.
    }
    return summarizeZipArchive([], fileSize, encrypted, true)
  }

  const buffer = await fs.readFile(path)
  let encrypted = buffer.length >= 30 && zipLocalHeadersEncrypted(buffer)

  const zip = await JSZip.loadAsync(buffer, { createFolders: true })
  const entries: ZipEntryInfo[] = []

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

  return summarizeZipArchive(entries, fileSize, encrypted, false)
}
