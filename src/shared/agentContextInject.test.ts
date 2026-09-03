import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatBlockContext,
  formatBlockContextBrief,
  formatFocusedFileContext,
  sniffFileKind
} from './agentContextInject.ts'
import { blockToPreviewRef } from './previewContext.ts'

describe('sniffFileKind', () => {
  it('matches File Preview kinds so CLI focus text stays consistent', () => {
    assert.equal(sniffFileKind('/tmp/notes.md'), 'text')
    assert.equal(sniffFileKind('/tmp/photo.png'), 'image')
    assert.equal(sniffFileKind('/tmp/brief.pdf'), 'pdf')
    assert.equal(sniffFileKind('/tmp/letter.docx'), 'office')
    assert.equal(sniffFileKind('/tmp/budget.xlsx'), 'office')
    assert.equal(sniffFileKind('/tmp/legacy.xls'), 'office')
    assert.equal(sniffFileKind('/tmp/deck.pptx'), 'office')
    assert.equal(sniffFileKind('/tmp/old.doc'), 'office')
    assert.equal(sniffFileKind('/tmp/pack.zip'), 'zip')
    assert.equal(sniffFileKind('/tmp/notes.db'), 'sqlite')
    assert.equal(sniffFileKind('/tmp/page.html'), 'html')
    assert.equal(sniffFileKind('/tmp/app.html'), 'html-clip')
    assert.equal(sniffFileKind('/tmp/data.csv'), 'csv')
    assert.equal(sniffFileKind('/tmp/blob.bin'), 'binary')
    assert.equal(sniffFileKind('/tmp/song.wav'), 'audio')
  })
})

describe('formatFocusedFileContext', () => {
  it('does not tell the model a database is a text document', () => {
    const out = formatFocusedFileContext('/tmp/notes.db', 'sqlite')
    assert.match(out, /SQLite/)
    assert.doesNotMatch(out, /primary document/)
  })

  it('describes html-clip as a rendered surface', () => {
    const out = formatFocusedFileContext('/tmp/app.html', 'html-clip')
    assert.match(out, /interactive HTML clip/)
  })
})

describe('formatBlockContext', () => {
  it('omits invented line ranges for office / media picks', () => {
    const ref = blockToPreviewRef('/tmp/deck.pptx', 'PPTX', {
      id: 'dom-0',
      kind: 'heading',
      text: 'Q3 Review',
      label: 'Slide 1 · title',
      startLine: 0,
      endLine: 0
    })
    const out = formatBlockContext(ref)
    assert.match(out, /Selected from \/tmp\/deck.pptx/)
    assert.doesNotMatch(out, /lines 0/)
    assert.doesNotMatch(out, /lines 1–1/)
    const brief = formatBlockContextBrief(ref)
    assert.match(brief, /Slide 1 · title/)
    assert.doesNotMatch(brief, /L0/)
  })

  it('keeps a real range for text picks without duplicating the chip label', () => {
    const ref = blockToPreviewRef('/tmp/a.md', 'Markdown', {
      id: 'h1-L4',
      kind: 'heading',
      text: '# Install',
      label: 'H1 Install',
      startLine: 4,
      endLine: 4
    })
    const out = formatBlockContext(ref)
    assert.match(out, /line 4/)
    assert.doesNotMatch(out, /lines 4–4/)
  })
})
