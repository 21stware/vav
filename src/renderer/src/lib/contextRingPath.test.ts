import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CONTEXT_RING_INSET,
  CONTEXT_RING_RADIUS,
  CONTEXT_RING_SIZE,
  CONTEXT_RING_STROKE,
  contextRingPath
} from './contextRingPath.ts'

type Point = { x: number; y: number }
type Cubic = { from: Point; c1: Point; c2: Point; end: Point }
type Line = { from: Point; end: Point }

function parsePath(d: string): {
  start: Point
  cubics: Cubic[]
  lines: Line[]
  closed: boolean
} {
  const tokens = d.trim().split(/\s+/)
  assert.equal(tokens[0], 'M')
  const start = { x: Number(tokens[1]), y: Number(tokens[2]) }
  let cursor = start
  const cubics: Cubic[] = []
  const lines: Line[] = []
  let i = 3
  while (i < tokens.length && tokens[i] !== 'Z') {
    if (tokens[i] === 'L') {
      const end = { x: Number(tokens[i + 1]), y: Number(tokens[i + 2]) }
      lines.push({ from: cursor, end })
      cursor = end
      i += 3
      continue
    }
    if (tokens[i] === 'C') {
      const c1 = { x: Number(tokens[i + 1]), y: Number(tokens[i + 2]) }
      const c2 = { x: Number(tokens[i + 3]), y: Number(tokens[i + 4]) }
      const end = { x: Number(tokens[i + 5]), y: Number(tokens[i + 6]) }
      cubics.push({ from: cursor, c1, c2, end })
      cursor = end
      i += 7
      continue
    }
    assert.fail(`unexpected token ${tokens[i]}`)
  }
  const closed = tokens[i] === 'Z'
  if (closed) i += 1
  assert.equal(i, tokens.length)
  return { start, cubics, lines, closed }
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

function near(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) < eps
}

describe('contextRingPath', () => {
  it('starts at 12 o’clock and is four cubic corners', () => {
    const { start, cubics, lines, closed } = parsePath(contextRingPath())
    assert.equal(start.x, CONTEXT_RING_SIZE / 2)
    assert.equal(start.y, CONTEXT_RING_INSET)
    assert.equal(cubics.length, 4)
    assert.ok(lines.length >= 4)
    assert.equal(closed, false)
    const last = lines[lines.length - 1]!
    assert.equal(last.end.x, start.x)
    assert.equal(last.end.y, start.y)
  })

  it('closes only when asked', () => {
    assert.equal(parsePath(contextRingPath({ close: true })).closed, true)
    assert.equal(parsePath(contextRingPath({ close: false })).closed, false)
  })

  it('keeps the stroke and round cap inside the viewBox', () => {
    const { start, cubics, lines } = parsePath(contextRingPath())
    const pad = CONTEXT_RING_STROKE / 2
    const points = [
      start,
      ...lines.flatMap((l) => [l.from, l.end]),
      ...cubics.flatMap((c) => [c.from, c.c1, c.c2, c.end])
    ]
    for (const point of points) {
      assert.ok(point.x >= pad - 1e-6, `x ${point.x} clips the cap`)
      assert.ok(point.y >= pad - 1e-6, `y ${point.y} clips the cap`)
      assert.ok(point.x <= CONTEXT_RING_SIZE - pad + 1e-6, `x ${point.x} clips the cap`)
      assert.ok(point.y <= CONTEXT_RING_SIZE - pad + 1e-6, `y ${point.y} clips the cap`)
    }
  })

  it('matches the 16px / 5px mark, outset by 2px', () => {
    assert.equal(CONTEXT_RING_RADIUS, 7)
    const { cubics } = parsePath(contextRingPath())
    const topRight = cubics[0]!
    assert.ok(near(topRight.from.x, CONTEXT_RING_SIZE - CONTEXT_RING_INSET - CONTEXT_RING_RADIUS))
    assert.ok(near(topRight.from.y, CONTEXT_RING_INSET))
    assert.ok(near(topRight.end.x, CONTEXT_RING_SIZE - CONTEXT_RING_INSET))
    assert.ok(near(topRight.end.y, CONTEXT_RING_INSET + CONTEXT_RING_RADIUS))
  })

  it('stays C1 where a side meets a cubic corner', () => {
    const { cubics } = parsePath(contextRingPath())
    for (const cubic of cubics) {
      const inTan = { x: cubic.c1.x - cubic.from.x, y: cubic.c1.y - cubic.from.y }
      const outTan = { x: cubic.end.x - cubic.c2.x, y: cubic.end.y - cubic.c2.y }
      // Incoming from the side: one axis is ~0 (horizontal or vertical).
      const inAxis = Math.abs(inTan.x) < 1e-6 || Math.abs(inTan.y) < 1e-6
      const outAxis = Math.abs(outTan.x) < 1e-6 || Math.abs(outTan.y) < 1e-6
      assert.ok(inAxis, `corner start is not axis-aligned (${inTan.x},${inTan.y})`)
      assert.ok(outAxis, `corner end is not axis-aligned (${outTan.x},${outTan.y})`)
    }
  })

  it('traces a continuous loop that never leaves the inset box', () => {
    const { cubics, lines } = parsePath(contextRingPath())
    const inset = CONTEXT_RING_INSET
    const max = CONTEXT_RING_SIZE - inset
    const inside = (p: Point) => {
      assert.ok(p.x >= inset - 1e-6 && p.x <= max + 1e-6)
      assert.ok(p.y >= inset - 1e-6 && p.y <= max + 1e-6)
    }
    for (const line of lines) {
      inside(line.from)
      inside(line.end)
    }
    for (const cubic of cubics) {
      for (let t = 0; t <= 1; t += 0.05) {
        inside(bezier(cubic.from, cubic.c1, cubic.c2, cubic.end, t))
      }
    }
  })
})
