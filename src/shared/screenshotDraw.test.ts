import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  arrowHead,
  clampCrop,
  cropIsUsable,
  hitCrop,
  hitMark,
  hitTopMark,
  moveCrop,
  moveMark,
  normalizeRect,
  resizeCrop,
  resizeMark,
  type ScreenshotMark
} from './screenshotDraw.ts'

describe('screenshotDraw', () => {
  it('normalizes inverted drag into a positive rect', () => {
    assert.deepEqual(normalizeRect(40, 30, 10, 5), { x: 10, y: 5, w: 30, h: 25 })
  })

  it('rejects tiny crops so a click does not lock a 1px selection', () => {
    assert.equal(cropIsUsable({ x: 0, y: 0, w: 7, h: 20 }), false)
    assert.equal(cropIsUsable({ x: 0, y: 0, w: 8, h: 8 }), true)
  })

  it('clamps a crop that overruns the display', () => {
    assert.deepEqual(clampCrop({ x: 90, y: 90, w: 40, h: 40 }, 100, 100), {
      x: 90,
      y: 90,
      w: 10,
      h: 10
    })
  })

  it('moves a crop without changing its size and stays on-screen', () => {
    assert.deepEqual(moveCrop({ x: 10, y: 10, w: 20, h: 20 }, 5, -8, 100, 100), {
      x: 15,
      y: 2,
      w: 20,
      h: 20
    })
    assert.deepEqual(moveCrop({ x: 10, y: 10, w: 20, h: 20 }, 90, 90, 100, 100), {
      x: 80,
      y: 80,
      w: 20,
      h: 20
    })
  })

  it('resizes from the eight handles and keeps a minimum size', () => {
    const origin = { x: 20, y: 20, w: 40, h: 40 }
    assert.deepEqual(resizeCrop(origin, 'se', 80, 90, 100, 100), {
      x: 20,
      y: 20,
      w: 60,
      h: 70
    })
    assert.deepEqual(resizeCrop(origin, 'nw', 10, 10, 100, 100), {
      x: 10,
      y: 10,
      w: 50,
      h: 50
    })
    assert.equal(resizeCrop(origin, 'e', 22, 40, 100, 100).w, 8)
  })

  it('hits handles first, then the whole crop body as move', () => {
    const crop = { x: 20, y: 20, w: 80, h: 80 }
    assert.equal(hitCrop(crop, 20, 20), 'nw')
    assert.equal(hitCrop(crop, 60, 20), 'n')
    assert.equal(hitCrop(crop, 28, 45), 'move')
    assert.equal(hitCrop(crop, 60, 60), 'move')
    assert.equal(hitCrop(crop, 0, 0), null)
  })

  it('reserves the interior for drawing when a draw tool is active', () => {
    const crop = { x: 20, y: 20, w: 80, h: 80 }
    assert.equal(hitCrop(crop, 60, 60, { interior: 'inside' }), 'inside')
    assert.equal(hitCrop(crop, 28, 45, { interior: 'inside' }), 'move')
  })

  it('selects, moves, and resizes drawn marks', () => {
    const rect: ScreenshotMark = {
      id: 'r',
      kind: 'rect',
      x1: 10,
      y1: 10,
      x2: 50,
      y2: 40,
      color: '#ef4444',
      width: 2
    }
    assert.equal(hitMark(rect, 10, 10), 'nw')
    assert.equal(hitMark(rect, 30, 25), 'move')
    assert.equal(hitMark(rect, 90, 90), null)
    assert.deepEqual(moveMark(rect, 8, 4, 100, 100), { ...rect, x1: 18, y1: 14, x2: 58, y2: 44 })
    assert.deepEqual(resizeMark(rect, 'se', 70, 60, 100, 100), {
      ...rect,
      x1: 10,
      y1: 10,
      x2: 70,
      y2: 60
    })

    const line: ScreenshotMark = {
      id: 'l',
      kind: 'line',
      x1: 0,
      y1: 0,
      x2: 40,
      y2: 0,
      color: '#111827',
      width: 4
    }
    assert.equal(hitMark(line, 0, 0), 'start')
    assert.equal(hitMark(line, 40, 0), 'end')
    assert.equal(hitMark(line, 20, 2), 'move')
    assert.deepEqual(resizeMark(line, 'end', 30, 12, 100, 100), { ...line, x2: 30, y2: 12 })

    const text: ScreenshotMark = {
      id: 't',
      kind: 'text',
      x: 10,
      y: 10,
      text: 'Hello world',
      color: '#fff',
      fontSize: 20
    }
    assert.equal(hitMark(text, 48, 24), 'move')
    const movedText = moveMark(text, 6, 0, 200, 200)
    assert.equal(movedText.kind === 'text' ? movedText.x : -1, 16)

    assert.equal(hitTopMark([rect, line], 20, 2)?.mark.id, 'l')
  })

  it('builds an arrow head that points at the tip', () => {
    const head = arrowHead(0, 0, 100, 0, 4)
    assert.equal(head.tip.x, 100)
    assert.equal(head.tip.y, 0)
    assert.ok(head.left.x < 100)
    assert.ok(head.right.x < 100)
    assert.ok(head.left.y * head.right.y < 0)
  })
})
