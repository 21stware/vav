/**
 * Structure-aware chunking: StructuredDocument blocks → DocChunk[].
 */

import type { PreviewBlock } from '@shared/previewBlock'
import type { StructuredDocument } from '@shared/structuredDoc'
import {
  DOC_CHUNK_MAX,
  DOC_CHUNK_MIN,
  DOC_CHUNK_TARGET,
  DOC_INDEX_MAX_CHUNKS,
  type DocChunk,
  type DocChunkKind
} from '@shared/docRetrieval'

function mapKind(kind: PreviewBlock['kind']): DocChunkKind {
  switch (kind) {
    case 'heading':
    case 'heading-section':
      return 'heading'
    case 'page':
      return 'page'
    case 'slide':
      return 'slide'
    case 'row':
      return 'sheet-row'
    case 'col':
      return 'section'
    case 'cell':
    case 'cell-table':
      return 'cell'
    case 'section':
    case 'sheet':
      return 'section'
    default:
      return 'paragraph'
  }
}

function pageFromBlock(block: PreviewBlock, sectionTitle?: string): number | undefined {
  const m =
    block.id.match(/^pdf-p(\d+)/i) ||
    block.id.match(/^page-(\d+)$/i) ||
    sectionTitle?.match(/Page\s+(\d+)/i)
  if (m) return Number(m[1])
  return undefined
}

function splitLong(text: string, max = DOC_CHUNK_MAX): string[] {
  if (text.length <= max) return [text]
  const parts: string[] = []
  // Prefer sentence boundaries.
  const sentences = text.split(/(?<=[.!?。！？\n])\s+/)
  let buf = ''
  for (const s of sentences) {
    if (!s) continue
    if (buf && buf.length + s.length + 1 > max) {
      parts.push(buf)
      buf = s
    } else {
      buf = buf ? `${buf} ${s}` : s
    }
  }
  if (buf) parts.push(buf)
  // Hard split any leftover monsters.
  const hard: string[] = []
  for (const p of parts) {
    if (p.length <= max) hard.push(p)
    else {
      for (let i = 0; i < p.length; i += max) hard.push(p.slice(i, i + max))
    }
  }
  return hard
}

interface RawPiece {
  text: string
  kind: DocChunkKind
  label?: string
  page?: number
  sectionId?: string
  blockId?: string
}

function collectPieces(doc: StructuredDocument): RawPiece[] {
  const pieces: RawPiece[] = []

  if (doc.sections.length > 0) {
    for (const section of doc.sections) {
      const walk = (blocks: PreviewBlock[]): void => {
        for (const b of blocks) {
          // Prefer leaves; skip pure containers when they have children.
          if (b.children?.length) {
            walk(b.children)
            continue
          }
          const text = (b.text ?? '').replace(/\s+/g, ' ').trim()
          if (!text || text === '(no extractable text)' || text === '(empty slide)') continue
          pieces.push({
            text,
            kind: mapKind(b.kind),
            label: b.label ?? section.title,
            page: pageFromBlock(b, section.title),
            sectionId: section.id,
            blockId: b.id
          })
        }
      }
      walk(section.blocks)
    }
  } else {
    const walk = (blocks: PreviewBlock[]): void => {
      for (const b of blocks) {
        if (b.children?.length) {
          walk(b.children)
          continue
        }
        const text = (b.text ?? '').replace(/\s+/g, ' ').trim()
        if (!text) continue
        pieces.push({
          text,
          kind: mapKind(b.kind),
          label: b.label,
          page: pageFromBlock(b),
          blockId: b.id
        })
      }
    }
    walk(doc.blocks)
  }

  if (pieces.length === 0 && doc.plainText.trim()) {
    for (const window of splitLong(doc.plainText, DOC_CHUNK_TARGET)) {
      const t = window.trim()
      if (t) pieces.push({ text: t, kind: 'window' })
    }
  }

  return pieces
}

/** Merge tiny pieces, split long ones, assign ord + ids. */
export function chunkStructuredDocument(doc: StructuredDocument): {
  chunks: DocChunk[]
  warnings: string[]
} {
  const warnings: string[] = [...(doc.warnings ?? [])]
  const pieces = collectPieces(doc)
  const merged: RawPiece[] = []

  let buf: RawPiece | null = null
  const flush = (): void => {
    if (!buf) return
    for (const part of splitLong(buf.text, DOC_CHUNK_MAX)) {
      merged.push({ ...buf, text: part })
    }
    buf = null
  }

  for (const p of pieces) {
    if (!buf) {
      buf = { ...p }
      continue
    }
    const sameSection =
      buf.sectionId === p.sectionId && buf.page === p.page && buf.kind === p.kind
    if (sameSection && buf.text.length < DOC_CHUNK_MIN && buf.text.length + p.text.length + 1 <= DOC_CHUNK_TARGET) {
      buf = {
        ...buf,
        text: `${buf.text} ${p.text}`,
        // Keep first blockId as primary.
        label: buf.label ?? p.label
      }
    } else {
      flush()
      buf = { ...p }
    }
  }
  flush()

  const chunks: DocChunk[] = []
  let offset = 0
  let ord = 0
  for (let i = 0; i < merged.length; i++) {
    if (chunks.length >= DOC_INDEX_MAX_CHUNKS) {
      warnings.push(`Indexed first ${DOC_INDEX_MAX_CHUNKS} of ${merged.length} chunks`)
      break
    }
    const p = merged[i]!
    const id =
      p.blockId && !chunks.some((c) => c.id === p.blockId)
        ? p.blockId
        : `${doc.kind}-${i}-${hash8(p.text)}`
    const start = offset
    const end = offset + p.text.length
    offset = end + 1
    chunks.push({
      id,
      path: doc.path,
      kind: p.kind,
      text: p.text,
      label: p.label,
      page: p.page,
      sectionId: p.sectionId,
      blockId: p.blockId,
      startOffset: start,
      endOffset: end,
      ord: ord++
    })
  }

  return { chunks, warnings }
}

function hash8(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8)
}
