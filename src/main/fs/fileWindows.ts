import { extname } from 'node:path'

/**
 * Technical windows — memory budgets for a single IPC/payload, NOT product
 * "file too large" limits. Larger files are opened via further windows or
 * `vav-local://` streaming.
 */
/** First paint window for UTF-8 text (progressive fill continues via readTextWindow). */
export const TEXT_WINDOW_BYTES = 128 * 1024
/** Larger window for agent fs_read / full-ish first load when explicitly requested. */
export const TEXT_WINDOW_BYTES_AGENT = 2 * 1024 * 1024
/** First structured office chunk for block-pick while native canvas loads. */
export const STRUCTURED_FIRST_BLOCKS = 48
export const STRUCTURED_FIRST_ROWS = 120
/** Soft ceiling for base64 IPC convenience (renderer should prefer vav-local stream). */
export const BINARY_BASE64_SOFT = 16 * 1024 * 1024
/** Soft budget for full OOXML structured parse in main (best-effort index). */
export const STRUCTURED_PARSE_SOFT = 32 * 1024 * 1024

export const WATCH_DEBOUNCE_MS = 300
/** Keep document indexing off the main thread while a preview is opening. */
export const INDEX_AFTER_OPEN_MS = 1500

export const TEXT_WINDOW_HARD_MAX = 16 * 1024 * 1024
export const BINARY_WINDOW_HARD_MAX = 4 * 1024 * 1024

export function clampByteWindow(
  startByte: number | undefined,
  maxBytes: number | undefined,
  defaultMax: number,
  hardMax: number
): { startByte: number; maxBytes: number } {
  return {
    startByte: Math.max(0, Math.floor(startByte ?? 0)),
    maxBytes: Math.max(1024, Math.min(hardMax, Math.floor(maxBytes ?? defaultMax)))
  }
}

export function officeUtf8WriteError(path: string): string | null {
  const ext = extname(path).toLowerCase()
  if (ext !== '.docx' && ext !== '.xlsx' && ext !== '.pptx' && ext !== '.pdf') return null
  return `Cannot write ${ext} as UTF-8 text (would corrupt the file). Use a format-aware tool or shell for binary office documents.`
}

/** Catch-all for FileService I/O helpers that return `{ ok: false }`. */
export function caughtIoError(err: unknown, fallback?: string): { ok: false; error: string } {
  return { ok: false, error: (err as Error).message || fallback || 'error' }
}

/** Directory / empty / oversized gates before a base64 IPC read. */
export function readBinaryStatReject(
  info: { isDirectory: boolean; size: number },
  opts: { directoryError: string; softMax: number }
): { ok: false; error: string } | null {
  if (info.isDirectory) return { ok: false, error: opts.directoryError }
  if (info.size <= 0) return { ok: false, error: 'File is empty.' }
  if (info.size > opts.softMax) {
    return {
      ok: false,
      error: `File is ${Math.round(info.size / 1024 / 1024)} MB — use vav-local:// stream (or inspect.streamUrl) instead of base64 IPC. Base64 is a soft memory budget, not a product open limit.`
    }
  }
  return null
}

export function readBinarySuccess(
  bytes: { toString: (enc: 'base64') => string; length: number },
  mime: string
): { ok: true; base64: string; size: number; mime: string } {
  return { ok: true, base64: bytes.toString('base64'), size: bytes.length, mime }
}

export function textFileFromWindow(win: {
  content: string
  truncated: boolean
  error?: string
}): { content: string; truncated: boolean; error?: string } {
  if (win.error) return { content: '', truncated: false, error: win.error }
  return { content: win.content, truncated: win.truncated }
}
