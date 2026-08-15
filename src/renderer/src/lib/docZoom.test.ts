import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  axisAnchoredScroll,
  clampDocScale,
  computeContainFit,
  computeFitScale,
  DOC_ZOOM_MAX,
  settleDocScale,
  settleTextZoom,
  TEXT_ZOOM_MAX,
  TEXT_ZOOM_MIN,
  wheelZoomFactor
} from './docZoom.ts'

describe('document fit scale', () => {
  it('shrinks a page that is wider than the pane', () => {
    assert.equal(computeFitScale(408, 816), 0.5)
  })

  it('never upscales past 100%', () => {
    assert.equal(computeFitScale(1600, 816), 1)
  })

  it('falls back to 1 before the stage or content is measured', () => {
    assert.equal(computeFitScale(0, 816), 1)
    assert.equal(computeFitScale(600, 0), 1)
  })
})

describe('contain fit', () => {
  it('takes the tighter axis so a tall photo opens whole', () => {
    // Width alone would allow 1x; the height is what constrains it.
    assert.equal(computeContainFit({ width: 800, height: 400 }, { width: 800, height: 1600 }), 0.25)
  })

  it('stays width-fitted while the height is unknown', () => {
    assert.equal(computeContainFit({ width: 400, height: 400 }, { width: 800, height: 0 }), 0.5)
  })

  it('never upscales a small picture', () => {
    assert.equal(computeContainFit({ width: 2000, height: 2000 }, { width: 64, height: 64 }), 1)
  })
})

describe('text zoom', () => {
  it('rests at 100% and reports it as the fit state', () => {
    assert.deepEqual(settleTextZoom(1.01), { scale: 1, atFit: true })
  })

  it('allows reading below 100%, unlike page fit', () => {
    assert.equal(settleTextZoom(0.8).scale, 0.8)
    assert.equal(settleTextZoom(0.1).scale, TEXT_ZOOM_MIN)
  })

  it('caps the upper end', () => {
    assert.equal(settleTextZoom(9).scale, TEXT_ZOOM_MAX)
  })
})

describe('document zoom clamping', () => {
  it('treats fit as the floor so pinching out lands on auto-fit', () => {
    assert.equal(clampDocScale(0.2, 0.5), 0.5)
    assert.equal(clampDocScale(0.8, 0.5), 0.8)
  })

  it('caps manual zoom', () => {
    assert.equal(clampDocScale(99, 0.5), DOC_ZOOM_MAX)
  })

  it('snaps near-fit scales exactly onto fit', () => {
    const snapped = settleDocScale(0.51, 0.5)
    assert.equal(snapped.scale, 0.5)
    assert.equal(snapped.atFit, true)

    const manual = settleDocScale(0.7, 0.5)
    assert.equal(manual.scale, 0.7)
    assert.equal(manual.atFit, false)
  })
})

describe('wheel zoom factor', () => {
  it('zooms in on negative delta and out on positive', () => {
    assert.ok(wheelZoomFactor(-10, 0, true) > 1)
    assert.ok(wheelZoomFactor(10, 0, true) < 1)
  })

  it('caps a single notch', () => {
    assert.ok(wheelZoomFactor(-4000, 0, false) <= 1.5)
    assert.ok(wheelZoomFactor(4000, 0, false) >= 1 / 1.5)
  })
})

describe('anchored scroll', () => {
  it('keeps the point under the cursor fixed when content is already scrolling', () => {
    // 1000px of content in a 500px port, scrolled to 200, cursor at 100.
    // Content point under the cursor is 300/1000 = 0.3; after 2× it sits at 600.
    const next = axisAnchoredScroll(200, 500, 1000, 2000, 100)
    assert.equal(next, 500)
  })

  it('accounts for the centring margin when content is narrower than the port', () => {
    // 400px content centred in a 500px port (50px margin). The cursor sits on
    // the content's midpoint, so doubling to 800 must keep the midpoint there:
    // scroll = 0.5 * 800 - 250 = 150.
    assert.equal(axisAnchoredScroll(0, 500, 400, 800, 250), 150)
  })

  it('never scrolls past the content bounds', () => {
    assert.equal(axisAnchoredScroll(0, 500, 400, 400, 250), 0)
    assert.equal(axisAnchoredScroll(500, 500, 1000, 600, 500), 100)
  })
})
