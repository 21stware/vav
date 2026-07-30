/**
 * XLSX → sheet / row / cell blocks via SheetJS.
 */

import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import type { PreviewBlock } from '@shared/previewBlock'
import type { StructuredDocument, StructuredSection } from '@shared/structuredDoc'

const MAX_ROWS = 400
const MAX_COLS = 40

export async function parseXlsx(path: string): Promise<StructuredDocument> {
  const buf = await readFile(path)
  const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true })
  const sections: StructuredSection[] = []
  const rootChildren: PreviewBlock[] = []
  const plainParts: string[] = []
  const warnings: string[] = []
  let line = 1

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const ref = sheet['!ref']
    if (!ref) {
      sections.push({
        id: `sheet-${slug(sheetName)}`,
        title: sheetName,
        kind: 'sheet',
        blocks: [],
        grid: []
      })
      continue
    }

    const range = XLSX.utils.decode_range(ref)
    const rowCount = Math.min(range.e.r - range.s.r + 1, MAX_ROWS)
    const colCount = Math.min(range.e.c - range.s.c + 1, MAX_COLS)
    if (range.e.r - range.s.r + 1 > MAX_ROWS || range.e.c - range.s.c + 1 > MAX_COLS) {
      warnings.push(
        `Sheet "${sheetName}" truncated to ${MAX_ROWS}×${MAX_COLS} for preview`
      )
    }

    const grid: string[][] = []
    const rowBlocks: PreviewBlock[] = []
    const sheetStart = line

    for (let r = 0; r < rowCount; r++) {
      const absR = range.s.r + r
      const cells: string[] = []
      const cellBlocks: PreviewBlock[] = []
      for (let c = 0; c < colCount; c++) {
        const absC = range.s.c + c
        const addr = XLSX.utils.encode_cell({ r: absR, c: absC })
        const cell = sheet[addr]
        const display =
          cell == null
            ? ''
            : cell.w != null
              ? String(cell.w)
              : cell.v != null
                ? String(cell.v)
                : ''
        cells.push(display)
        // Only non-empty cells become selectable blocks (keeps IPC + DOM light).
        if (display) {
          cellBlocks.push({
            id: `xlsx-${slug(sheetName)}-r${r}-c${c}-L${line}`,
            kind: 'cell-table',
            text: display,
            label: `${sheetName}!${addr}`,
            startLine: line,
            endLine: line
          })
        }
      }
      grid.push(cells)
      const rowText = cells.join('\t')
      // Skip fully empty rows in the block tree (grid still keeps alignment).
      if (!rowText.trim()) {
        rowBlocks.push({
          id: `xlsx-${slug(sheetName)}-row${r}-L${line}`,
          kind: 'row',
          text: '',
          label: `${sheetName} · row ${r + 1}`,
          startLine: line,
          endLine: line
        })
        line += 1
        continue
      }
      plainParts.push(rowText)
      rowBlocks.push({
        id: `xlsx-${slug(sheetName)}-row${r}-L${line}`,
        kind: 'row',
        text: rowText,
        label: `${sheetName} · row ${r + 1}`,
        startLine: line,
        endLine: line,
        children: cellBlocks.length ? cellBlocks : undefined
      })
      line += 1
    }

    const sheetId = `sheet-${slug(sheetName)}`
    const sheetBlock: PreviewBlock = {
      id: sheetId,
      kind: 'sheet',
      text: rowBlocks.map((b) => b.text).join('\n'),
      label: sheetName,
      startLine: sheetStart,
      endLine: Math.max(sheetStart, line - 1),
      children: rowBlocks
    }
    rootChildren.push(sheetBlock)
    sections.push({
      id: sheetId,
      title: sheetName,
      kind: 'sheet',
      blocks: rowBlocks,
      grid
    })
  }

  return {
    kind: 'xlsx',
    path,
    blocks: rootChildren,
    sections,
    plainText: plainParts.join('\n'),
    warnings: warnings.length ? warnings : undefined
  }
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'sheet'
}
