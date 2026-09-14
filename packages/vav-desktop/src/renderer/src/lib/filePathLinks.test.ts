import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  fileMentionDisplayName,
  fileMentionHtml,
  isFileMentionImage
} from './filePathLinks.ts'

describe('file mention chips', () => {
  it('shows the basename and keeps the full path on title', () => {
    const html = fileMentionHtml('/Users/oboo/Downloads/IMG_1555.JPG')
    assert.match(html, /class="md-file-chip"/)
    assert.match(html, /title="\/Users\/oboo\/Downloads\/IMG_1555.JPG"/)
    assert.match(html, /<span class="md-file-chip-name">IMG_1555.JPG<\/span>/)
    assert.doesNotMatch(html, /md-file-link/)
    assert.doesNotMatch(html, />\/Users\/oboo\/Downloads\/IMG_1555/)
  })

  it('uses a thumbnail for absolute image paths', () => {
    const html = fileMentionHtml('/tmp/shot.png')
    assert.match(html, /class="md-file-chip-thumb"/)
    assert.match(html, /vav-local:\/\/preview\/\?path=/)
  })

  it('uses a file glyph for non-images', () => {
    const html = fileMentionHtml('/tmp/notes.md')
    assert.doesNotMatch(html, /md-file-chip-thumb/)
    assert.match(html, /class="md-file-chip-icon"/)
    assert.match(html, /<span class="md-file-chip-name">notes.md<\/span>/)
  })

  it('fileMentionDisplayName / isFileMentionImage', () => {
    assert.equal(fileMentionDisplayName('/Users/x/a/b.ts'), 'b.ts')
    assert.equal(fileMentionDisplayName('C:\\shots\\a.JPG'), 'a.JPG')
    assert.equal(isFileMentionImage('/a/b.JPG'), true)
    assert.equal(isFileMentionImage('/a/b.ts'), false)
  })
})
