/**
 * Local document retrieval (small-scale RAG) for PDF / office files.
 * Chunks, search hits, and index metadata shared by main tools and optional UI.
 */

export type DocChunkKind =
  | 'paragraph'
  | 'heading'
  | 'page'
  | 'slide'
  | 'sheet-row'
  | 'cell'
  | 'section'
  | 'window'

export type DocIndexKind = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'text'

export interface DocChunk {
  /** Stable within a file version, e.g. "pdf-p3-para2" or "docx-42". */
  id: string
  path: string
  kind: DocChunkKind
  text: string
  label?: string
  /** 1-based PDF page when known. */
  page?: number
  sectionId?: string
  /** Matching PreviewBlock.id when 1:1 with structured preview. */
  blockId?: string
  startOffset?: number
  endOffset?: number
  /** Sibling order within section for neighbor expand. */
  ord: number
}

export type DocHitReason = 'bm25' | 'phrase' | 'neighbor' | 'selection' | 'kind'

export interface DocSearchHit {
  chunk: DocChunk
  score: number
  reasons: DocHitReason[]
  snippet: string
}

export interface DocIndexMeta {
  path: string
  size: number
  mtimeMs: number
  kind: DocIndexKind
  chunkCount: number
  version: 1
  warnings?: string[]
}

export interface DocSearchOptions {
  path?: string
  query: string
  topK?: number
  anchor?: {
    text?: string
    blockIds?: string[]
    chunkIds?: string[]
  }
  mode?: 'search' | 'related'
}

export interface DocFetchOptions {
  path: string
  ids?: string[]
  page?: number
  sectionId?: string
  limit?: number
}

/** Tunables for the built-in retrieval service. */
/** Soft technical budgets (not product caps) — prevent OOM, not truncate UX. */
export const DOC_INDEX_MAX_PDF_PAGES = 2_000
export const DOC_INDEX_MAX_FILE_BYTES = 128 * 1024 * 1024
export const DOC_INDEX_MAX_PLAIN_CHARS = 2_000_000
export const DOC_INDEX_MAX_CHUNKS = 20_000
export const DOC_SEARCH_DEFAULT_TOP_K = 8
export const DOC_SEARCH_MAX_TOP_K = 20
export const DOC_RELATED_NEIGHBOR_RADIUS = 2
export const DOC_SNIPPET_CHARS = 280
export const DOC_MEMORY_LRU = 32
export const DOC_CHUNK_MIN = 40
export const DOC_CHUNK_TARGET = 600
export const DOC_CHUNK_MAX = 1400
