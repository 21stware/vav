import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  UI_ZOOM_DEFAULT,
  UI_ZOOM_MAX,
  UI_ZOOM_MIN,
  clampUiZoom,
  stepUiZoom,
  uiZoomAppliesToUrl,
  uiZoomFromPercent,
  uiZoomPercent
} from './uiZoom.ts'

describe('clampUiZoom', () => {
  it('defaults junk and snaps to 5% steps', () => {
    assert.equal(clampUiZoom(undefined), UI_ZOOM_DEFAULT)
    assert.equal(clampUiZoom('nope'), UI_ZOOM_DEFAULT)
    assert.equal(clampUiZoom(NaN), UI_ZOOM_DEFAULT)
    assert.equal(clampUiZoom(0.2), UI_ZOOM_MIN)
    assert.equal(clampUiZoom(3), UI_ZOOM_MAX)
    assert.equal(clampUiZoom(1.27), 1.25)
    assert.equal(clampUiZoom('1.1'), 1.1)
  })
})

describe('uiZoom percent round-trip', () => {
  it('shows 100% at default and converts the slider', () => {
    assert.equal(uiZoomPercent(1), 100)
    assert.equal(uiZoomPercent(1.25), 125)
    assert.equal(uiZoomFromPercent(125), 1.25)
    assert.equal(uiZoomFromPercent(80), 0.8)
  })
})

describe('stepUiZoom', () => {
  it('walks 5% and stops at the ends', () => {
    assert.equal(stepUiZoom(1, 1), 1.05)
    assert.equal(stepUiZoom(1, -1), 0.95)
    assert.equal(stepUiZoom(UI_ZOOM_MAX, 1), UI_ZOOM_MAX)
    assert.equal(stepUiZoom(UI_ZOOM_MIN, -1), UI_ZOOM_MIN)
  })
})

describe('uiZoomAppliesToUrl', () => {
  it('skips screenshot overlays and measured popups', () => {
    assert.equal(uiZoomAppliesToUrl(''), true)
    assert.equal(uiZoomAppliesToUrl('http://localhost:5173/'), true)
    assert.equal(uiZoomAppliesToUrl('http://localhost:5173/?view=settings'), true)
    assert.equal(uiZoomAppliesToUrl('http://localhost:5173/?view=token-usage&id=1'), false)
    assert.equal(uiZoomAppliesToUrl('http://localhost:5173/?view=provider-account'), false)
    assert.equal(uiZoomAppliesToUrl('file:///tmp/renderer/screenshot.html'), false)
    assert.equal(uiZoomAppliesToUrl('http://localhost:5173/screenshot.html'), false)
  })
})
