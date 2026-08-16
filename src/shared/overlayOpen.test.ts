import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  inferDiagramKind,
  inferOverlayKind,
  overlayContentKey,
  overlayIdentity
} from './overlayOpen.ts'

describe('overlayOpen', () => {
  it('reuses the same identity for the same inline content', () => {
    const html = '<html><body>hi</body></html>'
    const a = overlayIdentity({ kind: 'app', text: html, filename: 'app.html' })
    const b = overlayIdentity({ kind: 'app', text: html, filename: 'app.html' })
    assert.equal(a, b)
    assert.notEqual(a, overlayIdentity({ kind: 'app', text: html + '!', filename: 'app.html' }))
  })

  it('prefers a real path over hashed content', () => {
    assert.equal(
      overlayIdentity({ path: '/tmp/vav-clips/a/photo.png', mediaSrc: 'data:image/png;base64,xx' }),
      '/tmp/vav-clips/a/photo.png'
    )
  })

  it('hashes long media src instead of storing it as the key', () => {
    const src = `data:image/png;base64,${'A'.repeat(4000)}`
    const key = overlayIdentity({ kind: 'image', mediaSrc: src })
    assert.match(key, /^src:[0-9a-f]{16}$/)
    assert.equal(overlayContentKey(src), overlayContentKey(src))
  })

  it('infers overlay kind from the path', () => {
    assert.equal(inferOverlayKind('/x/photo.png'), 'image')
    assert.equal(inferOverlayKind('/x/flow.mmd'), 'diagram')
    assert.equal(inferOverlayKind('/x/chart.vl.json'), 'diagram')
    assert.equal(inferOverlayKind('/x/app.html'), 'app')
    assert.equal(inferOverlayKind('/x/notes.md'), undefined)
    assert.equal(inferDiagramKind('/x/graph.dot'), 'graphviz')
    assert.equal(inferDiagramKind('/x/chart.vg.json'), 'vegalite')
  })
})
