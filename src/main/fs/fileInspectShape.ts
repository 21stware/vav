import type { BinaryFileMeta, FileInspectResult, ImageMetaField, SqliteDatabaseInfo, SqliteQueryResult } from '../../shared/ipc.ts'
import { localFileStreamUrl } from '../../shared/localFileUrl.ts'
import { countNewlines } from './filePreviewKind.ts'

export function deniedInspectResult(path: string, name: string, error: string): FileInspectResult {
  return { path, name, size: 0, kind: 'binary', mime: '', error }
}

export function directoryInspectResult(
  path: string,
  name: string,
  mtimeMs: number
): FileInspectResult {
  return {
    path,
    name,
    size: 0,
    mtimeMs,
    kind: 'directory',
    mime: 'inode/directory'
  }
}

export function inspectCaughtError(path: string, name: string, err: unknown): FileInspectResult {
  return {
    path,
    name,
    size: 0,
    kind: 'binary',
    mime: '',
    error: (err as Error).message
  }
}

export function textWindowInspectResult(
  base: FileInspectResult,
  win: {
    content: string
    truncated: boolean
    startByte: number
    endByte: number
    totalBytes: number
  }
): FileInspectResult {
  return {
    ...base,
    text: win.content,
    truncated: win.truncated,
    textWindow: {
      startByte: win.startByte,
      endByte: win.endByte,
      totalBytes: win.totalBytes
    },
    lineCount: win.content ? countNewlines(win.content) : 0
  }
}

export function sqliteInspectResult(
  base: FileInspectResult,
  sqlite: SqliteDatabaseInfo
): FileInspectResult {
  const summary = sqlite.tables
    .map((tb) => `${tb.name} (${tb.rowCount} rows · ${tb.columns.length} cols)`)
    .join('\n')
  return {
    ...base,
    sqlite,
    text: summary || '(no tables)',
    lineCount: sqlite.tables.length
  }
}

export function heicInspectResult(
  base: FileInspectResult,
  heic: { converted: boolean; previewPath: string; meta?: ImageMetaField[] }
): FileInspectResult {
  return {
    ...base,
    kind: 'image',
    mime: heic.converted ? 'image/jpeg' : 'image/heic',
    contentPath: heic.converted ? heic.previewPath : undefined,
    streamUrl: localFileStreamUrl(heic.previewPath),
    imageMeta: heic.meta,
    warnings: heic.converted
      ? ['HEIC decoded to a temporary JPEG for preview (original unchanged).']
      : undefined
  }
}

export function binaryInspectFallback(
  base: FileInspectResult,
  mtimeMs: number | undefined
): FileInspectResult {
  return {
    ...base,
    binaryMeta: {
      uti: 'public.data',
      permissions: '—',
      owner: '—',
      createdAt: null,
      modifiedAt: Number.isFinite(mtimeMs) ? (mtimeMs as number) : null,
      inode: '—',
      defaultApp: null
    }
  }
}

/** Keep the original path/name while previewing a converted sidecar. */
export function remappedConvertedInspect(
  inner: FileInspectResult,
  original: { path: string; name: string; size: number; mtimeMs: number },
  convertedPath: string,
  warning?: string
): FileInspectResult {
  return {
    ...inner,
    path: original.path,
    name: original.name,
    size: original.size,
    mtimeMs: original.mtimeMs,
    contentPath: convertedPath,
    streamUrl: localFileStreamUrl(convertedPath),
    warnings: [...(inner.warnings ?? []), ...(warning ? [warning] : [])]
  }
}

export const OFFICE_LARGE_PREVIEW_WARNING =
  'Large Office document — preview opens via streaming; full text index runs in the background.'

/** First-paint Office/PDF inspect: stream URL only; structured parse is background. */
export function officeFirstPaintInspect(
  base: FileInspectResult,
  opts: {
    locked?: boolean
    empty?: boolean
    streamUrl: string
    large?: boolean
    lockMessage: string
  }
): FileInspectResult {
  if (opts.locked) return { ...base, error: opts.lockMessage }
  if (opts.empty) return { ...base, error: 'File is empty.' }
  const next = { ...base, streamUrl: opts.streamUrl }
  if (opts.large) return { ...next, warnings: [OFFICE_LARGE_PREVIEW_WARNING] }
  return next
}

/** Early outs for background Office structured parse. */
export function structuredInspectReject(info: {
  isFile: boolean
  locked: boolean
  size: number
  parseSoft: number
  lockMessage: string
}): { ok: false; error: string } | null {
  if (!info.isFile) return { ok: false, error: 'Not a file' }
  if (info.locked) return { ok: false, error: info.lockMessage }
  if (info.size <= 0) return { ok: false, error: 'File is empty.' }
  if (info.size > info.parseSoft) {
    return { ok: false, error: 'Document too large for full structured index' }
  }
  return null
}

export function structuredInspectIsPartial(
  progressive: boolean,
  warnings: string[] | undefined
): boolean {
  return progressive || (warnings ?? []).some((w) => /partial|truncated|first/i.test(w))
}

export function sqliteQueryFailure(
  offset: number | undefined,
  limit: number | undefined,
  error: string
): SqliteQueryResult {
  return {
    columns: [],
    rows: [],
    total: 0,
    offset: offset ?? 0,
    limit: limit ?? 100,
    error
  }
}

export function legacyBinaryInspect(opts: {
  path: string
  name: string
  size: number
  mtimeMs?: number
  mime: string
  binaryMeta?: BinaryFileMeta
  warnings?: string[]
  error?: string
}): FileInspectResult {
  return {
    path: opts.path,
    name: opts.name,
    size: opts.size,
    mtimeMs: opts.mtimeMs,
    kind: 'binary',
    mime: opts.mime,
    binaryMeta: opts.binaryMeta,
    warnings: opts.warnings,
    error: opts.error
  }
}
