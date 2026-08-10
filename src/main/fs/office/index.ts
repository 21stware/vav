import { extname } from 'node:path'
import type { StructuredDocument, StructuredDocKind } from '@shared/structuredDoc'
import { isOfficeLockFile, OFFICE_LOCK_FILE_MESSAGE } from '@shared/officeLock'

export { isOfficeLockFile }

export function structuredKindForPath(path: string): StructuredDocKind | null {
  const ext = extname(path).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.docx') return 'docx'
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx'
  if (ext === '.pptx') return 'pptx'
  return null
}

/**
 * Full structured parse for selection / RAG. Callers decide whether size
 * warrants deferring this (soft memory budget) — we never refuse open here.
 *
 * Parsers (SheetJS / pdf.js / OOXML) load on demand so FileService import
 * does not pull them into every main-process boot.
 */
export interface StructuredParseOptions {
  /** Stop after this many body blocks (docx progressive first paint). */
  maxBlocks?: number
  /** Cap rows per sheet for xlsx first chunk. */
  maxRows?: number
}

export async function parseStructuredDocument(
  path: string,
  _size: number,
  opts?: StructuredParseOptions
): Promise<StructuredDocument> {
  if (isOfficeLockFile(path)) {
    throw new Error(OFFICE_LOCK_FILE_MESSAGE)
  }
  if (_size === 0) {
    throw new Error('File is empty.')
  }
  const kind = structuredKindForPath(path)
  if (!kind) throw new Error('Not a structured office/PDF document')

  switch (kind) {
    case 'docx':
      return (await import('./parseDocx')).parseDocx(path, {
        maxBlocks: opts?.maxBlocks
      })
    case 'xlsx':
      return (await import('./parseXlsx')).parseXlsx(path, {
        maxRows: opts?.maxRows
      })
    case 'pptx':
      return (await import('./parsePptx')).parsePptx(path, {
        // Reuse maxBlocks as first-N slides for progressive PPTX.
        maxSlides: opts?.maxBlocks
      })
    case 'pdf':
      return (await import('./parsePdf')).parsePdf(path)
  }
}
