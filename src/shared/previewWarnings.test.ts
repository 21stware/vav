import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isSilentPreviewWindowWarning } from './previewWarnings.ts'

describe('isSilentPreviewWindowWarning', () => {
  it('hides soft-cap / first-chunk index notes', () => {
    assert.equal(isSilentPreviewWindowWarning('Sheet Data truncated to 120×8'), true)
    assert.equal(isSilentPreviewWindowWarning('File truncated for preview'), true)
    assert.equal(
      isSilentPreviewWindowWarning('Partial structured index — first blocks only; native canvas continues.'),
      true
    )
    assert.equal(
      isSilentPreviewWindowWarning('Partial structured index — first 1 of 12 slides.'),
      true
    )
    assert.equal(isSilentPreviewWindowWarning('Text index scanned first 2 of 40 pages'), true)
  })

  it('keeps real load / format warnings visible', () => {
    assert.equal(isSilentPreviewWindowWarning('Legacy PowerPoint (.ppt): export to .pptx'), false)
    assert.equal(isSilentPreviewWindowWarning('This archive appears password-protected.'), false)
    assert.equal(isSilentPreviewWindowWarning('HEIC decoded to a temporary JPEG for preview (original unchanged).'), false)
  })
})
