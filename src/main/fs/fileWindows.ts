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
