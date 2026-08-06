/**
 * .vavpack — session export package format.
 *
 * ZIP archive with a custom suffix. Layout:
 *
 *   manifest.json          format metadata + file index
 *   conversations/<id>.json  session JSON (text only; large binaries externalized)
 *   blobs/<id>[.ext]       raw binary bytes (never base64-in-JSON)
 *   attachments/<…>        original attachment files when still on disk
 *
 * Large base64 runs that would otherwise bloat JSON (e.g. "DB dumped to base64")
 * are extracted into `blobs/` and replaced with a compact marker.
 */

export const VAVPACK_FORMAT = 'vavpack' as const
export const VAVPACK_VERSION = 1 as const
export const VAVPACK_EXTENSION = '.vavpack'

/** Compact placeholder left in conversation JSON where a binary blob lived. */
export const VAVPACK_BLOB_MARKER_RE = /\{\{vavpack:blob:([a-zA-Z0-9_-]+)\}\}/g

export function blobMarker(id: string): string {
  return `{{vavpack:blob:${id}}}`
}

export type VavpackBlobKind = 'base64-extract' | 'attachment' | 'data-url'

export interface VavpackBlobEntry {
  id: string
  /** Path inside the zip (posix). */
  path: string
  kind: VavpackBlobKind
  size: number
  sha256: string
  /** Best-effort original path (attachments) or mime/source hint. */
  originalPath?: string
  mimeHint?: string
  /** Where this blob was pulled from (for debugging / re-import notes). */
  source?: {
    conversationId: string
    messageId?: string
    field?: string
  }
}

export interface VavpackConversationEntry {
  id: string
  title: string
  /** Path inside the zip. */
  file: string
}

export interface VavpackManifest {
  format: typeof VAVPACK_FORMAT
  version: typeof VAVPACK_VERSION
  exportedAt: string
  appVersion: string
  conversations: VavpackConversationEntry[]
  blobs: VavpackBlobEntry[]
}

export function isVavpackManifest(value: unknown): value is VavpackManifest {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return (
    m.format === VAVPACK_FORMAT &&
    typeof m.version === 'number' &&
    Array.isArray(m.conversations) &&
    Array.isArray(m.blobs)
  )
}

/** Safe default filename from a session title. */
export function suggestVavpackName(title: string, multi = false): string {
  const raw = (title || 'session').trim() || 'session'
  const safe = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 48)
    .trim()
  const base = multi ? `${safe}-and-more` : safe
  return `${base || 'session'}${VAVPACK_EXTENSION}`
}
