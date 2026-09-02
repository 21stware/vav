import type { FileInspectResult } from '../../../shared/ipc.ts'
import type { PreviewRef } from '../../../shared/types.ts'
import { localFileStreamUrl } from '../../../shared/localFileUrl.ts'
import { basename, pathsEqual } from './path.ts'
import type { PreviewBlock } from './previewBlocks.ts'

export { pathsEqual }

export function countNewlinesLocal(text: string): number {
  if (!text) return 0
  let n = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++
  }
  if (text.charCodeAt(text.length - 1) === 10) n--
  return Math.max(n, 1)
}

export function collectBlocks(blocks: PreviewBlock[]): PreviewBlock[] {
  const out: PreviewBlock[] = []
  const walk = (list: PreviewBlock[]): void => {
    for (const b of list) {
      out.push(b)
      if (b.children) walk(b.children)
    }
  }
  walk(blocks)
  return out
}

export function applyFileDraftContent(
  prev: string | null,
  event: { content?: string; append?: string; baseLen?: number }
): string | null {
  if (typeof event.content === 'string') return event.content
  if (typeof event.append === 'string') {
    const base = prev ?? ''
    if (typeof event.baseLen === 'number' && base.length !== event.baseLen) return prev
    return base + event.append
  }
  return prev
}

/** Human title for the comment card header (kind · line N). */
export function formatCommentCardLabel(block: PreviewBlock): string {
  if (block.kind === 'line' || block.id.startsWith('line-L')) {
    return `line ${block.startLine}`
  }
  const kind = (block.kind || 'block').replace(/_/g, '-')
  if (block.startLine === block.endLine) return `${kind} · line ${block.startLine}`
  return `${kind} · lines ${block.startLine}–${block.endLine}`
}

/** One selected preview block → a composer comment-block reference. */
export function blockToRef(path: string, badge: string, block: PreviewBlock): PreviewRef {
  return {
    id: `${path}::${block.id}`,
    filePath: path,
    label: formatCommentCardLabel(block),
    startLine: block.startLine,
    endLine: block.endLine,
    text: block.text,
    badge
  }
}

/** Windowing / soft caps belong in render — never show as “truncated for preview”. */
export function isSilentPreviewWindowWarning(warning: string): boolean {
  return (
    /truncated to \d+\s*[x×]\s*\d+/i.test(warning) ||
    (/truncat/i.test(warning) && /for preview/i.test(warning)) ||
    /Sheet .+ truncated/i.test(warning)
  )
}

export function provisionalInspect(path: string): FileInspectResult | null {
  const name = basename(path)
  const base = {
    path,
    name,
    size: 0,
    streamUrl: localFileStreamUrl(path)
  }
  if (/\.pdf$/i.test(path)) {
    return { ...base, kind: 'pdf', mime: 'application/pdf' }
  }
  if (/\.docx$/i.test(path)) {
    return {
      ...base,
      kind: 'docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }
  }
  if (/\.xlsx$/i.test(path)) {
    return {
      ...base,
      kind: 'xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }
  }
  if (/\.pptx$/i.test(path)) {
    return {
      ...base,
      kind: 'pptx',
      mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    }
  }
  if (/\.zip$/i.test(path)) {
    return {
      ...base,
      kind: 'zip',
      mime: 'application/zip',
      zip: {
        entries: [],
        entryCount: 0,
        compressedSize: 0,
        uncompressedSize: 0,
        ratio: 0
      }
    }
  }
  return null
}
