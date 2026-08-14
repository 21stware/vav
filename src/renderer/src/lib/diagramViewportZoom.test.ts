import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clampDiagramZoom,
  IDENTITY_VIEW,
  isIdentityView,
  zoomViewAtClient
} from './diagramViewportCamera.ts'

describe('diagram viewport camera', () => {
  it('clamps zoom to the shared range', () => {
    assert.equal(clampDiagramZoom(0.01), 0.1)
    assert.equal(clampDiagramZoom(12), 8)
    assert.equal(clampDiagramZoom(1.25), 1.25)
  })

  it('treats the origin as identity', () => {
    assert.equal(isIdentityView(IDENTITY_VIEW), true)
    assert.equal(isIdentityView({ tx: 0.2, ty: -0.2, zoom: 1 }), true)
    assert.equal(isIdentityView({ tx: 12, ty: 0, zoom: 1 }), false)
    assert.equal(isIdentityView({ tx: 0, ty: 0, zoom: 1.4 }), false)
  })

  it('keeps the cursor world point fixed while zooming', () => {
    const view = { tx: 10, ty: 20, zoom: 1 }
    const next = zoomViewAtClient(view, 2, 110, 220, { left: 100, top: 200 })
    // Screen (10, 20) inside the host was world (0, 0) + offset.
    // After 2× the same screen point must still map to the same world point.
    const worldX = (10 - view.tx) / view.zoom
    const worldY = (20 - view.ty) / view.zoom
    assert.ok(Math.abs((10 - next.tx) / next.zoom - worldX) < 1e-9)
    assert.ok(Math.abs((20 - next.ty) / next.zoom - worldY) < 1e-9)
    assert.equal(next.zoom, 2)
  })
})
