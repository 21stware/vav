/**
 * vav-local file serve — Range from a short-lived memory cache so pdf.js
 * does not re-stat / re-open the same document on every byte window.
 */
import { createReadStream } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { parseVavLocalFilePath } from '../../shared/localFileUrl.ts'

const FILE_CACHE_MAX_BYTES = 8 * 1024 * 1024
const FILE_CACHE_TOTAL_BYTES = 24 * 1024 * 1024
const STREAM_WHOLE_FILE_MAX = 32 * 1024 * 1024

type CachedFile = {
  path: string
  size: number
  mtimeMs: number
  bytes: Uint8Array
  lastAccess: number
}

const fileCache = new Map<string, CachedFile>()

export function clearVavLocalFileCache(): void {
  fileCache.clear()
}

export function parseByteRange(
  header: string | null | undefined,
  size: number
): { start: number; end: number } | null {
  if (!header || size <= 0) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match) return null
  const startRaw = match[1]
  const endRaw = match[2]
  if (startRaw === '' && endRaw === '') return null
  if (startRaw === '') {
    const suffix = Number(endRaw)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(startRaw)
  const end = endRaw === '' ? size - 1 : Number(endRaw)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
    return null
  }
  return { start, end: Math.min(end, size - 1) }
}

export type VavLocalServeDeps = {
  ioPath: (requested: string) => string
  isAllowed: (path: string) => boolean
}

export type VavLocalServeResult =
  | { kind: 'options' }
  | { kind: 'error'; status: 400 | 403 | 404 }
  | {
      kind: 'file'
      filePath: string
      status: 200 | 206
      headers: Record<string, string>
      body: Uint8Array | ReadableStream<Uint8Array>
    }

async function statExisting(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    return { size: info.size, mtimeMs: info.mtimeMs }
  } catch {
    return null
  }
}

function evictFileCache(needed: number): void {
  let total = 0
  for (const entry of fileCache.values()) total += entry.bytes.byteLength
  if (total + needed <= FILE_CACHE_TOTAL_BYTES && fileCache.size < 12) return
  const ordered = [...fileCache.values()].sort((a, b) => a.lastAccess - b.lastAccess)
  for (const entry of ordered) {
    if (total + needed <= FILE_CACHE_TOTAL_BYTES && fileCache.size <= 8) return
    fileCache.delete(entry.path)
    total -= entry.bytes.byteLength
  }
}

async function cachedBytes(
  filePath: string,
  size: number,
  mtimeMs: number
): Promise<Uint8Array | null> {
  const hit = fileCache.get(filePath)
  if (hit && hit.size === size && hit.mtimeMs === mtimeMs) {
    hit.lastAccess = Date.now()
    return hit.bytes
  }
  if (size <= 0 || size > FILE_CACHE_MAX_BYTES) return null
  const bytes = new Uint8Array(await readFile(filePath))
  evictFileCache(bytes.byteLength)
  fileCache.set(filePath, {
    path: filePath,
    size,
    mtimeMs,
    bytes,
    lastAccess: Date.now()
  })
  return bytes
}

async function readFileRange(filePath: string, start: number, length: number): Promise<Uint8Array> {
  const handle = await open(filePath, 'r')
  try {
    const bytes = new Uint8Array(length)
    await handle.read(bytes, 0, length, start)
    return bytes
  } finally {
    await handle.close()
  }
}

function wholeFileStream(filePath: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>
}

function fileHeaders(
  size: number,
  range: { start: number; end: number } | null
): { status: 200 | 206; headers: Record<string, string>; length: number } {
  if (!range) {
    return {
      status: 200,
      length: size,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(size)
      }
    }
  }
  const length = range.end - range.start + 1
  return {
    status: 206,
    length,
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(length),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`
    }
  }
}

export async function serveVavLocalRequest(
  request: { url: string; method: string; range: string | null },
  deps: VavLocalServeDeps
): Promise<VavLocalServeResult> {
  if (request.method === 'OPTIONS') return { kind: 'options' }

  const requested = parseVavLocalFilePath(request.url)
  if (!requested) return { kind: 'error', status: 404 }

  const mapped = deps.ioPath(requested)
  const mappedInfo = mapped === requested ? null : await statExisting(mapped)
  const filePath = mappedInfo ? mapped : requested
  const info = mappedInfo ?? (await statExisting(filePath))
  if (!info) return { kind: 'error', status: 404 }

  if (!deps.isAllowed(requested) && (filePath === requested || !deps.isAllowed(filePath))) {
    return { kind: 'error', status: 403 }
  }

  const range = parseByteRange(request.range, info.size)
  if (request.range && !range) return { kind: 'error', status: 400 }
  const meta = fileHeaders(info.size, range)

  const cached = await cachedBytes(filePath, info.size, info.mtimeMs)
  if (cached) {
    const start = range?.start ?? 0
    const end = range ? range.end + 1 : cached.byteLength
    return {
      kind: 'file',
      filePath,
      status: meta.status,
      headers: meta.headers,
      body: cached.subarray(start, end)
    }
  }

  if (range) {
    const body = await readFileRange(filePath, range.start, meta.length)
    return { kind: 'file', filePath, status: 206, headers: meta.headers, body }
  }

  if (info.size <= STREAM_WHOLE_FILE_MAX) {
    return {
      kind: 'file',
      filePath,
      status: 200,
      headers: meta.headers,
      body: await readFile(filePath)
    }
  }

  return {
    kind: 'file',
    filePath,
    status: 200,
    headers: meta.headers,
    body: wholeFileStream(filePath)
  }
}
