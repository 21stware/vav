import { isAbsolute, resolve as resolvePath } from 'node:path'

export type DocPathHost = {
  workdir: string
  defaultDocPath?: () => string | null
  selectionAnchor?: () => Array<{ id: string; filePath: string; text?: string }>
}

export function resolveInWorkdir(workdir: string, path: string): string {
  return isAbsolute(path) ? path : resolvePath(workdir, path)
}

export function resolveDocPath(host: DocPathHost, raw: unknown): string | null {
  const explicit = typeof raw === 'string' ? raw.trim() : ''
  if (explicit) return resolveInWorkdir(host.workdir, explicit)
  const fromDefault = host.defaultDocPath?.()?.trim()
  if (fromDefault) return fromDefault
  const refs = host.selectionAnchor?.() ?? []
  const fromSel = refs.find((r) => r.filePath)?.filePath
  return fromSel?.trim() || null
}

export function buildSelectionAnchor(
  host: Pick<DocPathHost, 'selectionAnchor'>
): { text?: string; blockIds?: string[]; chunkIds?: string[] } | undefined {
  const refs = host.selectionAnchor?.() ?? []
  if (refs.length === 0) return undefined
  const texts: string[] = []
  const blockIds: string[] = []
  for (const ref of refs) {
    if (ref.text?.trim()) texts.push(ref.text.trim())
    const sep = ref.id.lastIndexOf('::')
    if (sep >= 0) blockIds.push(ref.id.slice(sep + 2))
    else if (ref.id) blockIds.push(ref.id)
  }
  return {
    text: texts.join('\n\n').slice(0, 4000),
    blockIds: blockIds.length ? blockIds : undefined,
    chunkIds: blockIds.length ? blockIds : undefined
  }
}

export function fsReadErrorHint(path: string, error: string): string {
  if (/\.(pdf|docx|xlsx|xls|pptx)$/i.test(path)) {
    return ' For office/PDF documents, use doc_search / doc_fetch.'
  }
  if (/\.(csv|tsv)$/i.test(path)) {
    return ' For CSV/TSV analysis prefer sql_query; doc_search also works.'
  }
  if (
    /\.(png|jpe?g|gif|webp|bmp|svg|heic|mp3|mp4|mov|wav|webm|mkv)$/i.test(path) ||
    /binary/i.test(error)
  ) {
    return ' Images/audio/video and other binaries cannot be read as UTF-8 text.'
  }
  return ''
}

export function textWindowPrefix(result: {
  truncated: boolean
  startByte: number
  endByte: number
  totalBytes: number
}): string {
  if (result.truncated) {
    return `[bytes ${result.startByte}–${result.endByte} of ${result.totalBytes}; truncated — call again with start_byte=${result.endByte}]\n\n`
  }
  if (result.startByte > 0) {
    return `[bytes ${result.startByte}–${result.endByte} of ${result.totalBytes}]\n\n`
  }
  return ''
}
