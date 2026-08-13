const BINARY_WRITE_EXTS = new Set(['.docx', '.xlsx', '.pptx', '.pdf'])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Partial Write / fs_write args while the model is still generating the body.
 * Binary Office is skipped — OOXML is not valid until the zip is complete.
 */
export function writeToolDraft(
  name: string,
  input: unknown
): { path: string; content: string } | null {
  const n = name.toLowerCase().replace(/[^a-z0-9_]/g, '')
  if (n !== 'fs_write' && n !== 'write' && n !== 'write_file' && n !== 'create_file') {
    return null
  }
  const args = asRecord(input) ?? {}
  const path =
    asString(args.path) ||
    asString(args.file_path) ||
    asString(args.filePath) ||
    asString(args.filename) ||
    asString(args.target_file) ||
    asString(args.targetFile)
  if (!path) return null
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : ''
  if (BINARY_WRITE_EXTS.has(ext)) return null
  const content =
    asString(args.content) ?? asString(args.contents) ?? asString(args.file_contents)
  if (content == null || content.length < 8) return null
  return { path, content }
}

export const FILE_DRAFT_MAX_CHARS = 400_000
export const FILE_DRAFT_MIN_INTERVAL_MS = 80
export const FILE_DRAFT_RESYNC_MS = 1_000

export type FileDraftPayload = {
  filePath: string
  content?: string
  append?: string
  baseLen?: number
}

/**
 * Per-path coalescer: throttle, skip no-ops, and send appends while the body
 * is a growing prefix so IPC does not clone the whole file every tick.
 */
export class FileDraftCoalescer {
  private last = new Map<string, { content: string; at: number; fullAt: number }>()

  next(filePath: string, raw: string, now = Date.now()): FileDraftPayload | null {
    const content = raw.length > FILE_DRAFT_MAX_CHARS ? raw.slice(0, FILE_DRAFT_MAX_CHARS) : raw
    const prev = this.last.get(filePath)
    if (prev && now - prev.at < FILE_DRAFT_MIN_INTERVAL_MS) return null
    if (prev && prev.content === content) return null

    const growing = !!prev && content.startsWith(prev.content) && content.length > prev.content.length
    const resync = !prev || !growing || now - prev.fullAt >= FILE_DRAFT_RESYNC_MS
    if (resync || !prev) {
      this.last.set(filePath, { content, at: now, fullAt: now })
      return { filePath, content }
    }
    this.last.set(filePath, { content, at: now, fullAt: prev.fullAt })
    return {
      filePath,
      append: content.slice(prev.content.length),
      baseLen: prev.content.length
    }
  }
}
