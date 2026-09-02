import type { FileInspectResult, ImageMetaField, SqliteDatabaseInfo } from '../../shared/ipc.ts'
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
