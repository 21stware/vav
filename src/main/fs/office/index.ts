import { extname } from 'node:path'
import type { StructuredDocument, StructuredDocKind } from '@shared/structuredDoc'
import { isOfficeLockFile, OFFICE_LOCK_FILE_MESSAGE } from '@shared/officeLock'
import { parseDocx } from './parseDocx'
import { parseXlsx } from './parseXlsx'
import { parsePptx } from './parsePptx'
import { parsePdf } from './parsePdf'

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
 */
export async function parseStructuredDocument(
  path: string,
  _size: number
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
      return parseDocx(path)
    case 'xlsx':
      return parseXlsx(path)
    case 'pptx':
      return parsePptx(path)
    case 'pdf':
      return parsePdf(path)
  }
}
