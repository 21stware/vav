import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CSV_ROW_PARSE_CAP,
  STRUCTURE_LINE_CAP,
  blockAtLine,
  csvCellBlock,
  formatBadge,
  isLineOrientedPath,
  lineBlockAt,
  parseBlocksForPath,
  parseCsvModel,
  parseMarkdownBlocks,
  parseNotebookBlocks,
  pickBlockAtLine
} from './previewBlocks.ts'

describe('parseMarkdownBlocks', () => {
  it('keeps heading / section / fence ids unique and line-absolute', () => {
    const src = [
      '---',
      'title: demo',
      '---',
      '',
      '# Install',
      '',
      'Run this:',
      '',
      '```bash',
      '# not a heading',
      'npm i',
      '```',
      '',
      '## Windows',
      '',
      '- one',
      '- two'
    ].join('\n')
    const blocks = parseMarkdownBlocks(src)
    const kinds = blocks.map((b) => b.kind)
    assert.ok(kinds.includes('frontmatter'))
    assert.ok(kinds.includes('heading'))
    const heading = blocks.find((b) => b.kind === 'heading' && b.level === 1)
    assert.ok(heading)
    assert.equal(heading!.startLine, 5)
    const fence = heading!.children?.find((c) => c.kind === 'code')
    assert.ok(fence, 'fenced code inside the H1 section must stay a child, not a new heading')
    assert.match(fence!.text, /# not a heading/)
  })
})

describe('parseCsvModel', () => {
  it('builds a sheet with on-demand cell/row blocks', () => {
    const model = parseCsvModel('name,qty\nalice,2\n,blank\n')
    assert.deepEqual(model.headers, ['name', 'qty'])
    assert.equal(model.rows.length, 2)
    assert.equal(model.totalRows, 2)
    assert.equal(model.rowCapped, false)
    const empty = csvCellBlock(model.headers, model.rows[1]!, 1, 0)
    assert.equal(empty.text, '')
    assert.equal(empty.id, 'cell-r2-c0')
  })

  it('caps dense sheets and reports the real row count', () => {
    const header = 'a,b'
    const body = Array.from({ length: CSV_ROW_PARSE_CAP + 40 }, (_, i) => `${i},x`).join('\n')
    const model = parseCsvModel(`${header}\n${body}`)
    assert.equal(model.rows.length, CSV_ROW_PARSE_CAP)
    assert.equal(model.totalRows, CSV_ROW_PARSE_CAP + 40)
    assert.equal(model.rowCapped, true)
  })

  it('parses quoted commas', () => {
    const model = parseCsvModel('city,note\n"Portland, OR","ok"\n')
    assert.deepEqual(model.rows[0], ['Portland, OR', 'ok'])
  })
})

describe('parseBlocksForPath + pick fallback', () => {
  it('indexes markdown, code, json, and notebooks by extension', () => {
    assert.equal(parseBlocksForPath('a.md', '# Hi\n\npara')[0]!.kind, 'heading')
    const py = parseBlocksForPath('a.py', 'def add(a, b):\n  return a + b\n')
    assert.ok(py.length > 0)
    const nb = parseNotebookBlocks(
      JSON.stringify({
        cells: [{ cell_type: 'code', source: ['print(1)\n'], execution_count: 1 }]
      })
    )
    assert.equal(nb[0]!.kind, 'cell')
    assert.equal(nb[0]!.label, 'In [1]')
  })

  it('falls back to a line block past the structure-index cap', () => {
    const lines = Array.from({ length: STRUCTURE_LINE_CAP + 20 }, (_, i) => `line-${i + 1}`)
    const text = lines.join('\n')
    const blocks = parseBlocksForPath('huge.ts', text)
    assert.equal(blockAtLine(blocks, STRUCTURE_LINE_CAP + 10), null)
    const pick = pickBlockAtLine(blocks, STRUCTURE_LINE_CAP + 10, text)
    assert.ok(pick)
    assert.equal(pick!.kind, 'line')
    assert.equal(pick!.startLine, STRUCTURE_LINE_CAP + 10)
    assert.equal(pick!.text, `line-${STRUCTURE_LINE_CAP + 10}`)
  })

  it('treats logs as line-oriented (no giant paragraph tree)', () => {
    const log = Array.from({ length: 120 }, (_, i) => `2026-09-02 INFO event ${i}`).join('\n')
    assert.equal(isLineOrientedPath('app.log', log), true)
    assert.deepEqual(parseBlocksForPath('app.log', log), [])
    const line = lineBlockAt(3, log)
    assert.equal(line?.text, '2026-09-02 INFO event 2')
  })
})

describe('formatBadge', () => {
  it('is consistent across preview kinds', () => {
    assert.equal(formatBadge('a.md', 'text'), 'Markdown')
    assert.equal(formatBadge('a.csv', 'csv'), 'CSV')
    assert.equal(formatBadge('a.docx', 'docx'), 'DOCX')
    assert.equal(formatBadge('a.xls', 'xlsx'), 'XLSX')
    assert.equal(formatBadge('app.html', 'html-clip'), 'App')
    assert.equal(formatBadge('xstate.html', 'html-clip'), 'XState')
    assert.equal(formatBadge('a.zip', 'zip'), 'ZIP')
    assert.equal(formatBadge('a.db', 'sqlite'), 'SQLite')
  })
})
