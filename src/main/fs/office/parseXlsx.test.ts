import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import * as XLSX from 'xlsx'
import { parseXlsx } from './parseXlsx.ts'

describe('parseXlsx', () => {
  it('exposes sheet / row / non-empty cell blocks with real line numbers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-xlsx-'))
    const path = join(dir, 'budget.xlsx')
    try {
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.aoa_to_sheet([
        ['Item', 'Qty'],
        ['Pens', 12],
        ['', ''],
        ['Paper', 4]
      ])
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
      XLSX.writeFile(wb, path)
      const doc = await parseXlsx(path)
      assert.equal(doc.kind, 'xlsx')
      assert.equal(doc.sections[0]?.kind, 'sheet')
      assert.ok(doc.plainText.includes('Pens'))
      const cells = doc.sections[0]!.blocks.flatMap((b) => b.children ?? [])
      assert.ok(cells.some((c) => c.text === 'Pens'))
      assert.ok(cells.every((c) => c.startLine > 0))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('honors a progressive row budget', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-xlsx-'))
    const path = join(dir, 'wide.xlsx')
    try {
      const wb = XLSX.utils.book_new()
      const rows = Array.from({ length: 40 }, (_, i) => [`r${i}`, i])
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['A', 'B'], ...rows]), 'Data')
      XLSX.writeFile(wb, path)
      const doc = await parseXlsx(path, { maxRows: 5 })
      const grid = doc.sections[0]?.grid ?? []
      assert.ok(grid.length <= 5)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
