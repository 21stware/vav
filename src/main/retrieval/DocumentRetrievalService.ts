/**
 * In-memory document index + BM25/structure ranker for agent tools.
 */

import { createHash } from 'node:crypto'
import { basename, extname } from 'node:path'
import { stat } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import {
  DOC_INDEX_MAX_FILE_BYTES,
  DOC_INDEX_MAX_PDF_PAGES,
  DOC_INDEX_MAX_PLAIN_CHARS,
  DOC_MEMORY_LRU,
  DOC_RELATED_NEIGHBOR_RADIUS,
  DOC_SEARCH_DEFAULT_TOP_K,
  DOC_SEARCH_MAX_TOP_K,
  DOC_SNIPPET_CHARS,
  type DocChunk,
  type DocFetchOptions,
  type DocIndexKind,
  type DocIndexMeta,
  type DocSearchHit,
  type DocSearchOptions,
  type DocHitReason
} from '@shared/docRetrieval'
import type { StructuredDocument } from '@shared/structuredDoc'
import { parseStructuredDocument, structuredKindForPath } from '../fs/office'
import { parsePdf } from '../fs/office/parsePdf'
import { chunkStructuredDocument } from './chunkDocument'
import { bm25Score, buildBm25, phraseBoost, tokenize, tokenOverlap, type Bm25State } from './lexical'

interface CachedIndex {
  meta: DocIndexMeta
  chunks: DocChunk[]
  bm25: Bm25State
  lastAccess: number
}

export class DocumentRetrievalService {
  private cache = new Map<string, CachedIndex>()
  private inflight = new Map<string, Promise<CachedIndex>>()

  /** Build or reuse an index for an absolute path. */
  async ensureIndex(path: string): Promise<DocIndexMeta> {
    const idx = await this.load(path)
    return idx.meta
  }

  async search(opts: DocSearchOptions): Promise<{
    hits: DocSearchHit[]
    meta: DocIndexMeta | null
    error?: string
  }> {
    const path = opts.path?.trim()
    if (!path) {
      return { hits: [], meta: null, error: 'path is required (absolute or workdir-relative)' }
    }

    let index: CachedIndex
    try {
      index = await this.load(path)
    } catch (err) {
      return { hits: [], meta: null, error: (err as Error).message }
    }

    const topK = clampInt(opts.topK ?? DOC_SEARCH_DEFAULT_TOP_K, 1, DOC_SEARCH_MAX_TOP_K)
    const mode = opts.mode ?? 'search'
    const query = (opts.query ?? '').trim()
    const anchorText = (opts.anchor?.text ?? '').trim()
    const anchorBlockIds = new Set(opts.anchor?.blockIds ?? [])
    const anchorChunkIds = new Set(opts.anchor?.chunkIds ?? [])

    // Resolve anchor chunks (selection).
    const anchorChunks = index.chunks.filter(
      (c) =>
        anchorChunkIds.has(c.id) ||
        (c.blockId && anchorBlockIds.has(c.blockId)) ||
        (anchorText && c.text.includes(anchorText.slice(0, 80)))
    )

    const qTokens = tokenize(query || anchorText)
    const scores = new Map<number, { score: number; reasons: Set<DocHitReason> }>()

    const bump = (i: number, add: number, reason: DocHitReason): void => {
      const cur = scores.get(i) ?? { score: 0, reasons: new Set() }
      cur.score += add
      cur.reasons.add(reason)
      scores.set(i, cur)
    }

    if (mode === 'related' || (opts.anchor && (anchorText || anchorChunks.length))) {
      for (const ac of anchorChunks) {
        for (let i = 0; i < index.chunks.length; i++) {
          const c = index.chunks[i]!
          if (c.id === ac.id) continue
          const sameSection =
            (ac.sectionId && c.sectionId === ac.sectionId) ||
            (ac.page != null && c.page === ac.page)
          if (sameSection && Math.abs(c.ord - ac.ord) <= DOC_RELATED_NEIGHBOR_RADIUS) {
            const dist = Math.abs(c.ord - ac.ord)
            bump(i, 4 - dist * 0.8, 'neighbor')
          }
        }
      }
      if (anchorText) {
        for (let i = 0; i < index.chunks.length; i++) {
          const c = index.chunks[i]!
          if (anchorChunks.some((a) => a.id === c.id)) continue
          const ov = tokenOverlap(anchorText, c.text)
          if (ov > 0.05) bump(i, ov * 6, 'selection')
        }
      }
    }

    if (qTokens.length > 0) {
      for (let i = 0; i < index.chunks.length; i++) {
        const s = bm25Score(index.bm25, i, qTokens)
        if (s > 0) bump(i, s, 'bm25')
        const pb = phraseBoost(query || anchorText, index.chunks[i]!.text)
        if (pb > 0) bump(i, pb * 3, 'phrase')
      }
    }

    // Kind boost
    for (const [i, val] of scores) {
      const kind = index.chunks[i]!.kind
      if (kind === 'heading') val.score += 0.4
      else if (kind === 'paragraph') val.score += 0.1
    }

    // If pure search with no scores, fall back to substring scan.
    if (scores.size === 0 && query) {
      const q = query.toLowerCase()
      for (let i = 0; i < index.chunks.length; i++) {
        if (index.chunks[i]!.text.toLowerCase().includes(q)) bump(i, 1, 'phrase')
      }
    }

    const ranked = [...scores.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, topK)

    const hits: DocSearchHit[] = ranked.map(([i, val]) => {
      const chunk = index.chunks[i]!
      return {
        chunk,
        score: round2(val.score),
        reasons: [...val.reasons],
        snippet: makeSnippet(chunk.text, query || anchorText, DOC_SNIPPET_CHARS)
      }
    })

    return { hits, meta: index.meta }
  }

  async fetch(opts: DocFetchOptions): Promise<{
    chunks: DocChunk[]
    meta: DocIndexMeta | null
    error?: string
  }> {
    const path = opts.path?.trim()
    if (!path) return { chunks: [], meta: null, error: 'path is required' }

    let index: CachedIndex
    try {
      index = await this.load(path)
    } catch (err) {
      return { chunks: [], meta: null, error: (err as Error).message }
    }

    const limit = clampInt(opts.limit ?? 20, 1, 50)
    let chunks: DocChunk[] = []

    if (opts.ids?.length) {
      const want = new Set(opts.ids)
      chunks = index.chunks.filter((c) => want.has(c.id) || (c.blockId && want.has(c.blockId)))
    } else if (opts.page != null) {
      chunks = index.chunks.filter((c) => c.page === opts.page)
    } else if (opts.sectionId) {
      chunks = index.chunks.filter((c) => c.sectionId === opts.sectionId)
    } else {
      return { chunks: [], meta: index.meta, error: 'Provide ids, page, or section_id' }
    }

    return { chunks: chunks.slice(0, limit), meta: index.meta }
  }

  clearCache(): void {
    this.cache.clear()
    this.inflight.clear()
  }

  // ---------------------------------------------------------------------------

  private async load(path: string): Promise<CachedIndex> {
    const existing = this.cache.get(path)
    const info = await stat(path)
    if (existing && existing.meta.size === info.size && existing.meta.mtimeMs === info.mtimeMs) {
      existing.lastAccess = Date.now()
      return existing
    }

    const pending = this.inflight.get(path)
    if (pending) return pending

    const job = this.build(path, info.size, info.mtimeMs).finally(() => {
      this.inflight.delete(path)
    })
    this.inflight.set(path, job)
    return job
  }

  private async build(path: string, size: number, mtimeMs: number): Promise<CachedIndex> {
    if (size <= 0) throw new Error('File is empty')
    if (size > DOC_INDEX_MAX_FILE_BYTES) {
      throw new Error(
        `File too large for document index (${Math.round(size / 1024 / 1024)} MB; max ${Math.round(DOC_INDEX_MAX_FILE_BYTES / 1024 / 1024)} MB)`
      )
    }

    const kind = kindForPath(path)
    let doc: StructuredDocument
    const warnings: string[] = []

    if (kind === 'pdf') {
      doc = await parsePdf(path, { maxPages: DOC_INDEX_MAX_PDF_PAGES })
    } else if (kind === 'docx' || kind === 'xlsx' || kind === 'pptx') {
      // Reuse office parsers; they share a 40MB cap — for larger, fail clearly.
      try {
        doc = await parseStructuredDocument(path, size)
      } catch (err) {
        throw new Error((err as Error).message)
      }
    } else if (kind === 'csv') {
      const raw = await readFile(path, 'utf8')
      const { doc: csvDoc, warnings: csvWarn } = structuredFromCsv(path, raw)
      doc = csvDoc
      warnings.push(...csvWarn)
    } else if (kind === 'text') {
      const raw = await readFile(path, 'utf8')
      const text = raw.slice(0, DOC_INDEX_MAX_PLAIN_CHARS)
      if (raw.length > DOC_INDEX_MAX_PLAIN_CHARS) {
        warnings.push(`Text truncated to ${DOC_INDEX_MAX_PLAIN_CHARS} characters`)
      }
      doc = {
        kind: 'docx', // structural shell; chunks marked window
        path,
        blocks: [
          {
            id: 'text-body',
            kind: 'paragraph',
            text,
            startLine: 1,
            endLine: text.split('\n').length
          }
        ],
        sections: [
          {
            id: 'body',
            title: basename(path),
            kind: 'body',
            blocks: [
              {
                id: 'text-body',
                kind: 'paragraph',
                text,
                startLine: 1,
                endLine: text.split('\n').length
              }
            ]
          }
        ],
        plainText: text
      }
    } else {
      throw new Error(`Unsupported document type for retrieval: ${extname(path) || path}`)
    }

    if (doc.plainText.length > DOC_INDEX_MAX_PLAIN_CHARS) {
      warnings.push(`Plain text truncated for indexing`)
      doc = {
        ...doc,
        plainText: doc.plainText.slice(0, DOC_INDEX_MAX_PLAIN_CHARS)
      }
    }

    const { chunks, warnings: chunkWarnings } = chunkStructuredDocument(doc)
    warnings.push(...chunkWarnings)
    if (chunks.length === 0) {
      throw new Error('No extractable text to index (scanned PDF or empty document?)')
    }

    const bm25 = buildBm25(chunks.map((c) => c.text))
    const meta: DocIndexMeta = {
      path,
      size,
      mtimeMs,
      kind: kind === 'text' || kind === 'csv' ? 'text' : kind,
      chunkCount: chunks.length,
      version: 1,
      warnings: warnings.length ? warnings : undefined
    }

    const entry: CachedIndex = { meta, chunks, bm25, lastAccess: Date.now() }
    this.cache.set(path, entry)
    this.evictLru()
    return entry
  }

  private evictLru(): void {
    if (this.cache.size <= DOC_MEMORY_LRU) return
    const ordered = [...this.cache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)
    const drop = ordered.length - DOC_MEMORY_LRU
    for (let i = 0; i < drop; i++) {
      this.cache.delete(ordered[i]![0])
    }
  }
}

function kindForPath(path: string): DocIndexKind | 'csv' | 'unsupported' {
  const structured = structuredKindForPath(path)
  if (structured) return structured
  const ext = extname(path).toLowerCase()
  if (ext === '.csv' || ext === '.tsv') return 'csv'
  if (
    [
      '.md',
      '.markdown',
      '.mdx',
      '.txt',
      '.json',
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.py',
      '.rs',
      '.go',
      '.java',
      '.c',
      '.cpp',
      '.h',
      '.css',
      '.html',
      '.xml',
      '.yml',
      '.yaml',
      '.toml',
      '.ini',
      '.log'
    ].includes(ext)
  ) {
    return 'text'
  }
  return 'unsupported'
}

/** Max rows indexed for CSV/TSV (prevents OOM on multi‑MB tables). */
const CSV_INDEX_MAX_ROWS = 5000

/**
 * Structure CSV as sheet rows (+ header col labels) so doc_search can hit
 * rows/columns instead of a single text blob.
 */
function structuredFromCsv(
  path: string,
  raw: string
): { doc: StructuredDocument; warnings: string[] } {
  const warnings: string[] = []
  const delim = path.toLowerCase().endsWith('.tsv') ? '\t' : ','
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0) {
    return {
      doc: {
        kind: 'xlsx',
        path,
        blocks: [],
        sections: [],
        plainText: '',
        warnings: ['Empty CSV']
      },
      warnings: ['Empty CSV']
    }
  }

  const parseLine = (line: string): string[] => {
    if (delim === '\t') return line.split('\t')
    // Minimal RFC4180-ish CSV split
    const cells: string[] = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"'
          i++
        } else if (ch === '"') q = false
        else cur += ch
      } else if (ch === '"') q = true
      else if (ch === ',') {
        cells.push(cur)
        cur = ''
      } else cur += ch
    }
    cells.push(cur)
    return cells
  }

  const headers = parseLine(lines[0]!)
  const bodyLines = lines.slice(1)
  if (bodyLines.length > CSV_INDEX_MAX_ROWS) {
    warnings.push(`CSV truncated to first ${CSV_INDEX_MAX_ROWS} of ${bodyLines.length} rows`)
  }
  const body = bodyLines.slice(0, CSV_INDEX_MAX_ROWS).map(parseLine)
  const colCount = Math.max(headers.length, ...body.map((r) => r.length), 1)

  // Row chunks only (no cell children) so BM25 indexes full field=value rows.
  const rowBlocks: StructuredDocument['blocks'] = body.map((row, idx) => {
    const cells = Array.from({ length: colCount }, (_, c) => row[c] ?? '')
    const pairs = Array.from(
      { length: colCount },
      (_, c) => `${headers[c] || `col${c + 1}`}=${cells[c] ?? ''}`
    )
    return {
      id: `row-${idx + 1}`,
      kind: 'row' as const,
      text: pairs.join(' | '),
      label: `row ${idx + 1}`,
      startLine: idx + 2,
      endLine: idx + 2
    }
  })

  // One chunk per column (values under that header) for "filter by column" queries.
  const colBlocks = Array.from({ length: colCount }, (_, c) => {
    const name = headers[c] || `col${c + 1}`
    const values = body.map((r) => r[c] ?? '').filter(Boolean)
    const text = [`# ${name}`, ...values.slice(0, 200)].join('\n')
    return {
      id: `col-${c}`,
      kind: 'col' as const,
      text,
      label: `col ${name}`,
      startLine: 1,
      endLine: body.length + 1
    }
  })

  const plainText = [headers.join(delim), ...body.map((r) => r.join(delim))]
    .join('\n')
    .slice(0, DOC_INDEX_MAX_PLAIN_CHARS)

  const doc: StructuredDocument = {
    kind: 'xlsx',
    path,
    blocks: [...colBlocks, ...rowBlocks],
    sections: [
      {
        id: 'sheet-csv',
        title: basename(path),
        kind: 'sheet',
        blocks: [...colBlocks, ...rowBlocks]
      }
    ],
    plainText,
    warnings: warnings.length ? warnings : undefined
  }
  return { doc, warnings }
}

function makeSnippet(text: string, query: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const q = query.trim()
  if (q.length >= 2) {
    const idx = flat.toLowerCase().indexOf(q.toLowerCase().slice(0, 40))
    if (idx >= 0) {
      const start = Math.max(0, idx - Math.floor(max / 3))
      const slice = flat.slice(start, start + max)
      return `${start > 0 ? '…' : ''}${slice}${start + max < flat.length ? '…' : ''}`
    }
  }
  return `${flat.slice(0, max)}…`
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Stable path key for disk caches (future). */
export function indexKeyForPath(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 24)
}
