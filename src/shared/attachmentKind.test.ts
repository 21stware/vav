import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { attachmentExtLabel, attachmentKindFromPath, fileExt } from './attachmentKind.ts'

describe('attachmentKind', () => {
  it('reads the last extension', () => {
    assert.equal(fileExt('/tmp/notes.backup.md'), 'md')
    assert.equal(fileExt('C:\\Users\\a\\Report.PDF'), 'pdf')
    assert.equal(fileExt('/tmp/Makefile'), '')
  })

  it('classifies common types', () => {
    assert.equal(attachmentKindFromPath('shot.png'), 'image')
    assert.equal(attachmentKindFromPath('spec.pdf'), 'pdf')
    assert.equal(attachmentKindFromPath('grid.xlsx'), 'sheet')
    assert.equal(attachmentKindFromPath('deck.pptx'), 'slide')
    assert.equal(attachmentKindFromPath('app.tsx'), 'code')
    assert.equal(attachmentKindFromPath('pack.zip'), 'archive')
    assert.equal(attachmentKindFromPath('readme.md'), 'text')
    assert.equal(attachmentKindFromPath('blob.bin'), 'file')
  })

  it('caps long extensions so the tile label stays short', () => {
    assert.equal(attachmentExtLabel('a.markdown'), 'MARKD')
    assert.equal(attachmentExtLabel('a.ts'), 'TS')
    assert.equal(attachmentExtLabel('noext'), 'FILE')
  })
})
