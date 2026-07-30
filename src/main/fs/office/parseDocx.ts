/**
 * DOCX → structured blocks via OOXML (document.xml).
 * Walks body children in document order so tables interleave with paragraphs.
 */

import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import type { PreviewBlock } from '@shared/previewBlock'
import type { StructuredDocument, StructuredSection } from '@shared/structuredDoc'
import { isOfficeLockFile, OFFICE_LOCK_FILE_MESSAGE } from '@shared/officeLock'

export { isOfficeLockFile }

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: false,
  // Keep p / tbl / sdt in document order (critical for mixed body content).
  preserveOrder: true,
  // Text nodes as { "#text": "..." } under their element.
  textNodeName: '#text'
})

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Collect visible text from a w:p / w:tc tree.
 * - Joins w:t runs without inventing spaces
 * - Turns w:tab into a single space
 * - Collapses CJK-internal spacing Word inserts for justification
 */
function collectText(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object') return ''

  // preserveOrder: array of single-key objects
  if (Array.isArray(node)) {
    return node.map((item) => collectText(item)).join('')
  }

  const obj = node as Record<string, unknown>

  // Tab character
  if ('tab' in obj) return '\t'

  // Direct text
  if (obj['#text'] != null) return String(obj['#text'])

  // w:t element shape under preserveOrder: { t: [ { '#text': 'x' } ] } or { t: [...] }
  if ('t' in obj) return collectText(obj.t)

  let out = ''
  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_')) continue
    if (key === 'rPr' || key === 'pPr' || key === 'tcPr' || key === 'tblPr' || key === 'tblGrid') {
      continue
    }
    out += collectText(obj[key])
  }
  return out
}

function normalizeDocText(raw: string): string {
  let text = raw
    // Word soft breaks / non-breaking spaces
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
  // Collapse runs of spaces/tabs to single space, keep intentional underscores.
  text = text.replace(/[^\S\n]+/g, ' ')
  // Remove spaces between CJK characters (common in justified Chinese Word docs).
  text = text.replace(
    /([\u3400-\u9fff\uf900-\ufaff])\s+(?=[\u3400-\u9fff\uf900-\ufaff])/g,
    '$1'
  )
  // Spaces between CJK and fullwidth punctuation
  text = text.replace(/([\u3400-\u9fff])\s+([，。；：！？、）】」』])/g, '$1$2')
  text = text.replace(/([（【「『])\s+([\u3400-\u9fff])/g, '$1$2')
  return text.trim()
}

function headingLevel(styleId: string | undefined): number | null {
  if (!styleId) return null
  const m = styleId.match(/^(?:Heading|heading|标题|Titel)(\d)$/i)
  if (m) return Math.min(6, Math.max(1, Number(m[1])))
  if (/^Title$/i.test(styleId)) return 1
  if (/^Subtitle$/i.test(styleId)) return 2
  return null
}

/** preserveOrder body item → first element name + value */
function entryOf(item: unknown): { name: string; value: unknown } | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const obj = item as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_') || key === ':@') continue
    return { name: key, value: obj[key] }
  }
  return null
}

function styleIdFromP(pValue: unknown): string | undefined {
  // pValue is array of children under preserveOrder
  const kids = asArray(pValue)
  for (const kid of kids) {
    const e = entryOf(kid)
    if (!e || e.name !== 'pPr') continue
    for (const pr of asArray(e.value)) {
      const se = entryOf(pr)
      if (se?.name === 'pStyle') {
        const attrs = (pr as Record<string, unknown>)[':@'] as Record<string, unknown> | undefined
        const fromAttr = attrs?.['@_val']
        if (fromAttr != null) return String(fromAttr)
        // sometimes val is nested
        for (const x of asArray(se.value)) {
          if (x && typeof x === 'object' && '@_val' in (x as object)) {
            return String((x as Record<string, unknown>)['@_val'])
          }
        }
      }
    }
  }
  // Also try non-order shape
  if (pValue && typeof pValue === 'object' && !Array.isArray(pValue)) {
    const p = pValue as Record<string, unknown>
    const pPr = p.pPr as Record<string, unknown> | undefined
    const pStyle = pPr?.pStyle as Record<string, unknown> | undefined
    if (pStyle?.['@_val']) return String(pStyle['@_val'])
  }
  return undefined
}

function parseParagraph(
  pValue: unknown,
  line: number
): PreviewBlock | null {
  const text = normalizeDocText(collectText(pValue))
  if (!text) return null
  const level = headingLevel(styleIdFromP(pValue))
  if (level != null) {
    return {
      id: `docx-h${level}-L${line}`,
      kind: 'heading',
      text,
      level,
      label: `H${level} · ${text.slice(0, 48)}`,
      startLine: line,
      endLine: line
    }
  }
  return {
    id: `docx-p-L${line}`,
    kind: 'paragraph',
    text,
    label: text.slice(0, 64),
    startLine: line,
    endLine: line
  }
}

function parseTable(tblValue: unknown, tableIndex: number, startLine: number): {
  block: PreviewBlock
  nextLine: number
  plain: string[]
} {
  const rowsRaw: unknown[] = []
  // preserveOrder: tbl value is array of { tr: ... } etc.
  for (const item of asArray(tblValue)) {
    const e = entryOf(item)
    if (e?.name === 'tr') rowsRaw.push(e.value)
    // non-order: tbl.tr
  }
  if (rowsRaw.length === 0 && tblValue && typeof tblValue === 'object' && !Array.isArray(tblValue)) {
    rowsRaw.push(...asArray((tblValue as Record<string, unknown>).tr))
  }

  const rowBlocks: PreviewBlock[] = []
  const plain: string[] = []
  let line = startLine

  for (let ri = 0; ri < rowsRaw.length; ri++) {
    const trValue = rowsRaw[ri]
    const cellsRaw: unknown[] = []
    for (const item of asArray(trValue)) {
      const e = entryOf(item)
      if (e?.name === 'tc') cellsRaw.push(e.value)
    }
    if (cellsRaw.length === 0 && trValue && typeof trValue === 'object' && !Array.isArray(trValue)) {
      cellsRaw.push(...asArray((trValue as Record<string, unknown>).tc))
    }

    const cellTexts = cellsRaw.map((c) => normalizeDocText(collectText(c)))
    // Keep empty cells for column alignment in the grid.
    while (cellTexts.length > 0 && cellTexts[cellTexts.length - 1] === '') {
      // don't trim trailing empties from short rows — keep as-is for colspan-ish display
      break
    }
    const rowText = cellTexts.join('\t')
    if (!rowText.trim()) continue

    plain.push(rowText)
    rowBlocks.push({
      id: `docx-tbl${tableIndex}-row${ri}-L${line}`,
      kind: 'row',
      text: rowText,
      label: `Row ${ri + 1}`,
      startLine: line,
      endLine: line,
      children: cellTexts.map((ct, ci) => ({
        id: `docx-tbl${tableIndex}-r${ri}-c${ci}-L${line}`,
        kind: 'cell-table' as const,
        text: ct,
        label: `R${ri + 1}C${ci + 1}`,
        startLine: line,
        endLine: line
      }))
    })
    line += 1
  }

  const block: PreviewBlock = {
    id: `docx-table-${tableIndex}-L${startLine}`,
    kind: 'table',
    text: rowBlocks.map((r) => r.text).join('\n'),
    label: `Table ${tableIndex + 1}`,
    startLine,
    endLine: Math.max(startLine, line - 1),
    children: rowBlocks
  }
  return { block, nextLine: line, plain }
}

/** Walk preserveOrder body for p / tbl / sdt (content controls). */
function walkBodyItems(
  items: unknown[],
  into: PreviewBlock[],
  plainParts: string[],
  lineStart: number
): number {
  let line = lineStart
  let tableIndex = 0

  const visit = (list: unknown[]): void => {
    for (const item of list) {
      const e = entryOf(item)
      if (!e) continue
      if (e.name === 'p') {
        const block = parseParagraph(e.value, line)
        if (block) {
          into.push(block)
          plainParts.push(block.text)
          line += 1
        }
      } else if (e.name === 'tbl') {
        const { block, nextLine, plain } = parseTable(e.value, tableIndex, line)
        tableIndex += 1
        if (block.children?.length) {
          into.push(block)
          plainParts.push(...plain)
          line = nextLine
        }
      } else if (e.name === 'sdt') {
        // Content control — dig for sdtContent
        for (const kid of asArray(e.value)) {
          const ke = entryOf(kid)
          if (ke?.name === 'sdtContent') {
            visit(asArray(ke.value))
          }
        }
      }
    }
  }

  visit(items)
  return line
}

export async function parseDocx(path: string): Promise<StructuredDocument> {
  if (isOfficeLockFile(path)) {
    throw new Error(OFFICE_LOCK_FILE_MESSAGE)
  }

  const buf = await readFile(path)
  // PK\x03\x04 — valid zip local file header
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error(
      'Not a valid DOCX package (missing ZIP signature). The file may be corrupt or a temporary lock file.'
    )
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buf)
  } catch {
    throw new Error(
      'Could not open DOCX as a package. If the name starts with ~ or ~$, it is a Word lock file — open the real document.'
    )
  }

  const docXml = await zip.file('word/document.xml')?.async('string')
  if (!docXml) {
    throw new Error('Invalid DOCX: missing word/document.xml')
  }

  const parsed = parser.parse(docXml) as unknown[]
  // preserveOrder root: [ { '?xml': ... }, { document: [ { body: [...] } ] } ]
  let bodyItems: unknown[] = []
  for (const top of asArray(parsed)) {
    const e = entryOf(top)
    if (e?.name !== 'document') continue
    for (const d of asArray(e.value)) {
      const de = entryOf(d)
      if (de?.name === 'body') {
        bodyItems = asArray(de.value)
        break
      }
    }
  }

  // Fallback: non-order parse if preserveOrder found nothing
  if (bodyItems.length === 0) {
    const loose = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
      trimValues: false
    }).parse(docXml) as Record<string, unknown>
    const document = (loose.document ?? loose) as Record<string, unknown>
    const body = (document.body ?? {}) as Record<string, unknown>
    // Rebuild pseudo-order: all p then all tbl (best effort)
    const rebuilt: unknown[] = []
    for (const p of asArray(body.p)) rebuilt.push({ p })
    for (const tbl of asArray(body.tbl)) rebuilt.push({ tbl })
    bodyItems = rebuilt
  }

  const blocks: PreviewBlock[] = []
  const plainParts: string[] = []
  const line = walkBodyItems(bodyItems, blocks, plainParts, 1)

  const section: StructuredSection = {
    id: 'docx-body',
    title: 'Document',
    kind: 'body',
    blocks
  }

  const bodyBlock: PreviewBlock = {
    id: 'docx-body',
    kind: 'section',
    text: plainParts.join('\n'),
    label: 'Document',
    startLine: 1,
    endLine: Math.max(1, line - 1),
    children: blocks
  }

  return {
    kind: 'docx',
    path,
    blocks: [bodyBlock],
    sections: [section],
    plainText: plainParts.join('\n')
  }
}
