import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { convertEditProfileFor, fileViewerKindFlags, isBinaryOfficeKind, isPreviewKindSelectable } from './fileViewerKinds.ts'

describe('fileViewerKindFlags', () => {
  it('treats markdown, notebooks, and csv by extension', () => {
    assert.equal(fileViewerKindFlags({ filePath: '/a.md', displayText: '', hasInfo: false }).isMarkdown, true)
    assert.equal(fileViewerKindFlags({ filePath: '/a.ipynb', displayText: '{}', hasInfo: false }).isNotebook, true)
    assert.equal(fileViewerKindFlags({ filePath: '/a.csv', displayText: 'a,b', hasInfo: true }).isCsv, true)
    assert.equal(fileViewerKindFlags({ filePath: '/a.ts', kind: 'csv', displayText: '', hasInfo: true }).isCsv, true)
  })

  it('detects mind maps, mermaid, and draw.io canvases', () => {
    const mm = fileViewerKindFlags({
      filePath: '/map.mm',
      kind: 'text',
      displayText: '<map version="1.0.1"><node TEXT="root"/></map>',
      hasInfo: true
    })
    assert.equal(mm.isMindMap, true)
    assert.equal(mm.isDiagramCanvas, true)
    assert.equal(mm.bodyPad, 'none')

    const mermaid = fileViewerKindFlags({
      filePath: '/flow.mmd',
      kind: 'text',
      displayText: 'graph TD; A-->B',
      hasInfo: true
    })
    assert.equal(mermaid.isMermaidFile, true)
    assert.equal(mermaid.textZoomable, false)

    const drawio = fileViewerKindFlags({
      filePath: '/board.drawio',
      kind: 'text',
      displayText: '',
      hasInfo: true
    })
    assert.equal(drawio.isDrawioFile, true)
    assert.equal(drawio.hardForcedReadOnly, true)
  })

  it('locks HEIC / PDF / legacy Office to convert-then-save-as', () => {
    assert.equal(
      fileViewerKindFlags({ filePath: '/a.heic', mime: 'image/heic', displayText: '', hasInfo: true })
        .formatLockedReadOnly,
      true
    )
    assert.equal(
      fileViewerKindFlags({ filePath: '/a.pdf', kind: 'pdf', displayText: '', hasInfo: true })
        .formatLockedReadOnly,
      true
    )
    const legacy = fileViewerKindFlags({ filePath: '/a.doc', displayText: '', hasInfo: true })
    assert.equal(legacy.isLegacyOffice, true)
    assert.equal(legacy.formatLockedReadOnly, true)
    assert.equal(legacy.hardForcedReadOnly, false)
  })

  it('forces read-only for zip, directories, and html clips', () => {
    assert.equal(
      fileViewerKindFlags({ filePath: '/a.zip', kind: 'zip', displayText: '', hasInfo: true }).hardForcedReadOnly,
      true
    )
    assert.equal(
      fileViewerKindFlags({ filePath: '/dir', kind: 'directory', displayText: '', hasInfo: true })
        .hardForcedReadOnly,
      true
    )
    assert.equal(
      fileViewerKindFlags({
        filePath: '/clip.html',
        kind: 'html-clip',
        displayText: '',
        hasInfo: true
      }).hardForcedReadOnly,
      true
    )
  })

  it('treats dense logs as line-oriented and keeps prose padded', () => {
    const log = fileViewerKindFlags({
      filePath: '/out.log',
      kind: 'text',
      displayText: 'ok',
      hasInfo: true
    })
    assert.equal(log.lineOriented, true)
    const prose = fileViewerKindFlags({
      filePath: '/notes.txt',
      kind: 'text',
      displayText: 'hello',
      hasInfo: true
    })
    assert.equal(prose.bodyPad, 'text')
    assert.equal(prose.textZoomable, true)
    assert.equal(
      fileViewerKindFlags({
        filePath: '/a.mp3',
        kind: 'audio',
        displayText: '',
        hasInfo: true
      }).bodyPad,
      'none'
    )
  })

  it('identifies binary office kinds for the working-copy save path', () => {
    assert.equal(isBinaryOfficeKind('docx'), true)
    assert.equal(isBinaryOfficeKind('pdf'), true)
    assert.equal(isBinaryOfficeKind('text'), false)
  })

  it('builds convert+Save As profiles for HEIC and legacy Office', () => {
    const heic = convertEditProfileFor('/photos/a.heic', {
      isHeic: true,
      isLegacyOffice: false,
      contentPath: '/tmp/a.jpg'
    })
    assert.equal(heic?.formatKey, 'jpeg')
    assert.equal(heic?.suggestedPath, '/photos/a.jpg')
    assert.equal(heic?.sourcePath, '/tmp/a.jpg')
    const doc = convertEditProfileFor('/docs/a.doc', {
      isHeic: false,
      isLegacyOffice: true
    })
    assert.equal(doc?.formatKey, 'docx')
    assert.equal(doc?.suggestedPath, '/docs/a.docx')
    assert.equal(convertEditProfileFor('/notes.txt', { isHeic: false, isLegacyOffice: false }), null)
  })

  it('treats office, html, zip, and media canvases as selectable', () => {
    assert.equal(isPreviewKindSelectable('text', false), true)
    assert.equal(isPreviewKindSelectable('zip', false), true)
    assert.equal(isPreviewKindSelectable('image', false), false)
    assert.equal(isPreviewKindSelectable('image', true), true)
    assert.equal(isPreviewKindSelectable('binary', false), false)
  })
})
