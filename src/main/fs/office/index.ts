import { extname } from 'node:path'
import type { StructuredDocument, StructuredDocKind } from '@shared/structuredDoc'
import { isOfficeLockFile, OFFICE_LOCK_FILE_MESSAGE } from '@shared/officeLock'
import { parseDocx } from './parseDocx'
import { parseXlsx } from './parseXlsx'
import { parsePptx } from './parsePptx'
import { parsePdf } from './parsePdf'

export { isOfficeLockFile }

/** Soft technical budget for full OOXML parse in main (not a product page cap). */
const OFFICE_CAP = 200 * 1024 * 1024

export function structuredKindForPath(path: string): StructuredDocKind | null {
  const ext = extname(path).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.docx') return 'docx'
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx'
  if (ext === '.pptx') return 'pptx'
  return null
}

export async function parseStructuredDocument(
  path: string,
  size: number
): Promise<StructuredDocument> {
  if (isOfficeLockFile(path)) {
    throw new Error(OFFICE_LOCK_FILE_MESSAGE)
  }
  if (size > OFFICE_CAP) {
    throw new Error(`File too large for structured preview (${Math.round(size / 1024 / 1024)} MB)`)
  }
  if (size === 0) {
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
