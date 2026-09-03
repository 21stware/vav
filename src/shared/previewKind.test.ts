import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isDocumentPreviewKind,
  isHtmlClipName,
  isOfficePreviewKind,
  mimeForPreviewKind,
  previewKind
} from './previewKind.ts'

describe('previewKind — every File Preview kind', () => {
  const cases: Array<[string, ReturnType<typeof previewKind>]> = [
    ['notes.md', 'text'],
    ['README', 'text'],
    ['app.ts', 'text'],
    ['Makefile', 'text'],
    ['.env.local', 'text'],
    ['.eslintrc', 'text'],
    ['data.csv', 'csv'],
    ['sheet.tsv', 'csv'],
    ['photo.png', 'image'],
    ['scan.heic', 'image'],
    ['vector.svg', 'image'],
    ['brief.pdf', 'pdf'],
    ['song.mp3', 'audio'],
    ['clip.mov', 'video'],
    ['archive.zip', 'zip'],
    ['letter.docx', 'docx'],
    ['budget.xlsx', 'xlsx'],
    ['legacy.xls', 'xlsx'],
    ['deck.pptx', 'pptx'],
    ['notes.db', 'sqlite'],
    ['app.sqlite3', 'sqlite'],
    ['page.html', 'html'],
    ['index.xhtml', 'html'],
    ['app.html', 'html-clip'],
    ['board.app.html', 'html-clip'],
    ['xstate.html', 'html-clip'],
    ['widget.html-clip', 'html-clip'],
    ['blob.bin', 'binary'],
    ['Installer.dmg', 'binary']
  ]

  for (const [name, kind] of cases) {
    it(`classifies ${name} as ${kind}`, () => {
      assert.equal(previewKind(name), kind)
    })
  }

  it('is path-separator safe', () => {
    assert.equal(previewKind('C:\\\\Users\\\\me\\\\notes.md'), 'text')
    assert.equal(previewKind('/tmp/workspace/budget.xlsx'), 'xlsx')
  })
})

describe('previewKind helpers', () => {
  it('detects html-clip names', () => {
    assert.equal(isHtmlClipName('app.html'), true)
    assert.equal(isHtmlClipName('site/index.html'), false)
  })

  it('groups office / document kinds consistently', () => {
    assert.equal(isOfficePreviewKind('docx'), true)
    assert.equal(isOfficePreviewKind('pdf'), true)
    assert.equal(isOfficePreviewKind('html'), false)
    assert.equal(isDocumentPreviewKind('csv'), true)
    assert.equal(isDocumentPreviewKind('image'), false)
  })

  it('returns a stable mime per kind', () => {
    assert.equal(mimeForPreviewKind('a.docx', 'docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    assert.equal(mimeForPreviewKind('a.csv', 'csv'), 'text/csv')
    assert.equal(mimeForPreviewKind('a.svg', 'image'), 'image/svg+xml')
    assert.equal(mimeForPreviewKind('a.html', 'html'), 'text/html')
  })
})
