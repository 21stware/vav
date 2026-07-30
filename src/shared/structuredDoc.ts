/**
 * Structured office / PDF document model for file preview.
 *
 * Not a pixel dump or iframe: documents are parsed into hierarchical
 * selectable blocks (same PreviewBlock contract as MD / code) so Edit mode
 * can pick paragraphs, cells, slides, and pages for Agent comments.
 */

import type { PreviewBlock } from './previewBlock'

export type StructuredDocKind = 'pdf' | 'docx' | 'xlsx' | 'pptx'

/** One visual section: PDF page, PPTX slide, XLSX sheet, or DOCX body stream. */
export interface StructuredSection {
  id: string
  /** Human title: "Page 3", "Slide 1", "Sheet1". */
  title: string
  kind: 'page' | 'slide' | 'sheet' | 'body'
  /** Selectable content blocks (paragraphs, rows, cells, …). */
  blocks: PreviewBlock[]
  /**
   * Sheet grid (xlsx only): rows of cell display strings.
   * Cell blocks still carry absolute ids for selection.
   */
  grid?: string[][]
}

export interface StructuredDocument {
  kind: StructuredDocKind
  path: string
  /** Flat tree root for hit-testing / comment cards (sections as parents). */
  blocks: PreviewBlock[]
  sections: StructuredSection[]
  /** Plain-text reconstruction for agent tools / search. */
  plainText: string
  /** Warnings (truncated pages, encrypted, etc.). */
  warnings?: string[]
}
