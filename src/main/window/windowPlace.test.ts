import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { overlayCascadeOrigin, placeDetachedBounds } from './windowPlace.ts'

describe('windowPlace', () => {
  it('cascades overlays and parks detached sessions on the right edge', () => {
    const area = { x: 0, y: 0, width: 1440, height: 900 }
    assert.deepEqual(overlayCascadeOrigin(area, null, { width: 800, height: 600 }), {})
    const cascaded = overlayCascadeOrigin(area, { x: 10, y: 20 }, { width: 800, height: 600 }, 28)
    assert.deepEqual(cascaded, { x: 38, y: 48 })
    const overflow = overlayCascadeOrigin(
      area,
      { x: 1400, y: 800 },
      { width: 800, height: 600 },
      28
    )
    assert.equal(overflow.x, 640)
    assert.equal(overflow.y, 300)
    const parked = placeDetachedBounds(area, { width: 480, height: 700 }, 0, 400)
    assert.equal(parked.width, 480)
    assert.equal(parked.x, 1440 - 480 - 28)
  })
})
