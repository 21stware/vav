import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CONTEXT_RING_INSET,
  CONTEXT_RING_SIZE,
  CONTEXT_RING_STROKE,
  contextRingPath
} from './contextRingPath.ts'

type Point = { x: number; y: number }
type Cubic = { c1: Point; c2: Point; end: Point }

function parsePath(d: string): { start: Point; cubics: Cubic[]; closed: boolean } {
  const tokens = d.trim().split(/\s+/)
  assert.equal(tokens[0], 'M')
  const start = { x: Number(tokens[1]), y: Number(tokens[2]) }
  const cubics: Cubic[] = []
  let i = 3
  while (i < tokens.length && tokens[i] === 'C') {
    cubics.push({
      c1: { x: Number(tokens[i + 1]), y: Number(tokens[i + 2]) },
      c2: { x: Number(tokens[i + 3]), y: Number(tokens[i + 4]) },
      end: { x: Number(tokens[i + 5]), y: Number(tokens[i + 6]) }
    })
    i += 7
  }
  const closed = tokens[i] === 'Z'
  if (closed) i += 1
  assert.equal(i, tokens.length)
  return { start, cubics, closed }
}

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t
  const mt2 = mt * mt
  const t2 = t * t
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y
  }
}

describe('contextRingPath', () => {
  it('starts at 12 o’clock and is eight cubics (two per corner)', () => {
    const { start, cubics, closed } = parsePath(contextRingPath())
    assert.equal(start.x, CONTEXT_RING_SIZE / 2)
    assert.equal(start.y, CONTEXT_RING_INSET)
    assert.equal(cubics.length, 8)
    assert.equal(closed, false)
    const last = cubics[7]!
    assert.equal(last.end.x, start.x)
    assert.equal(last.end.y, start.y)
  })

  it('closes only when asked', () => {
    assert.equal(parsePath(contextRingPath({ close: true })).closed, true)
    assert.equal(parsePath(contextRingPath({ close: false })).closed, false)
  })

  it('keeps the stroke and round cap inside the viewBox', () => {
    const { start, cubics } = parsePath(contextRingPath())
    const pad = CONTEXT_RING_STROKE / 2
    const points = [start, ...cubics.flatMap((c) => [c.c1, c.c2, c.end])]
    for (const point of points) {
      assert.ok(point.x >= pad - 1e-6, `x ${point.x} clips the cap`)
      assert.ok(point.y >= pad - 1e-6, `y ${point.y} clips the cap`)
      assert.ok(point.x <= CONTEXT_RING_SIZE - pad + 1e-6, `x ${point.x} clips the cap`)
      assert.ok(point.y <= CONTEXT_RING_SIZE - pad + 1e-6, `y ${point.y} clips the cap`)
    }
  })

  it('stays C1 at the quadrant joins so the line is not bumpy', () => {
    const { cubics } = parsePath(contextRingPath())
    for (let i = 0; i < cubics.length; i++) {
      const cur = cubics[i]!
      const next = cubics[(i + 1) % cubics.length]!
      const inn = { x: cur.end.x - cur.c2.x, y: cur.end.y - cur.c2.y }
      const out = { x: next.c1.x - cur.end.x, y: next.c1.y - cur.end.y }
      const cross = inn.x * out.y - inn.y * out.x
      const dot = inn.x * out.x + inn.y * out.y
      // 3-decimal path rounding leaves a sub-pixel residual (~0.003).
      assert.ok(Math.abs(cross) < 0.01, `join ${i} kinks (cross ${cross})`)
      assert.ok(dot > 0, `join ${i} reverses`)
    }
  })

  it('traces a continuous loop that never leaves the inset box', () => {
    const { start, cubics } = parsePath(contextRingPath())
    const inset = CONTEXT_RING_INSET
    const max = CONTEXT_RING_SIZE - inset
    let p0 = start
    for (const cubic of cubics) {
      for (let t = 0; t <= 1; t += 0.05) {
        const p = bezier(p0, cubic.c1, cubic.c2, cubic.end, t)
        assert.ok(p.x >= inset - 1e-6 && p.x <= max + 1e-6)
        assert.ok(p.y >= inset - 1e-6 && p.y <= max + 1e-6)
      }
      p0 = cubic.end
    }
  })
})
