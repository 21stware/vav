import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { looksLikeAppClip, looksLikeVisualOverlay, shouldOpenAsOverlay } from './previewOverlay.ts'

describe('previewOverlay', () => {
  it('treats app / xstate / clip html as an app overlay', () => {
    assert.equal(looksLikeAppClip('/tmp/vav-clips/x/app.html'), true)
    assert.equal(looksLikeAppClip('/tmp/vav-clips/x/xstate.html'), true)
    assert.equal(looksLikeAppClip('/tmp/vav-clips/x/page.html'), true)
    assert.equal(looksLikeAppClip('/Users/me/site/index.html'), false)
  })

  it('treats conversation visuals as overlay previews', () => {
    assert.equal(looksLikeVisualOverlay('/tmp/vav-clips/a/photo.png'), true)
    assert.equal(looksLikeVisualOverlay('/proj/chart.vl.json'), true)
    assert.equal(looksLikeVisualOverlay('/proj/flow.mmd'), true)
    assert.equal(looksLikeVisualOverlay('/proj/graph.dot'), true)
    assert.equal(looksLikeVisualOverlay('/proj/notes.md'), false)
    assert.equal(looksLikeVisualOverlay('/proj/app.ts'), false)
  })

  it('does not treat a File Session image as an overlay', () => {
    assert.equal(shouldOpenAsOverlay('/proj/photo.png', 'file'), false)
    assert.equal(shouldOpenAsOverlay('/proj/photo.png'), false)
    assert.equal(shouldOpenAsOverlay('/proj/photo.png', 'app'), true)
    assert.equal(shouldOpenAsOverlay('/tmp/vav-clips/a/photo.png'), true)
    assert.equal(shouldOpenAsOverlay('/tmp/vav-clips/a/app.html'), true)
  })
})
