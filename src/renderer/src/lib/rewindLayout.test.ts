import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  FISHEYE_MIN_TURNS,
  dockMagnify,
  layoutRewindRail,
  rewindCenters,
  rewindIndexAtY,
  rewindSlotWeights
} from './rewindLayout.ts'

describe('rewindSlotWeights', () => {
  it('puts more space at the focus than at the far end of a long list', () => {
    const weights = rewindSlotWeights(80, 40, 480)
    assert.ok(weights[40]! > weights[0]! * 2)
    assert.ok(weights[40]! > weights[79]!)
  })

  it('stays even when every item already fits comfortably', () => {
    const weights = rewindSlotWeights(4, 1, 400)
    assert.ok(weights.every((w) => w === weights[0]))
    // Room for 20 turns at a full pitch each: still no squeeze.
    const roomy = rewindSlotWeights(20, 10, 500)
    assert.ok(roomy.every((w) => w === roomy[0]))
  })

  it('never squeezes a short thread, however tight the rail', () => {
    const weights = rewindSlotWeights(FISHEYE_MIN_TURNS, 5, 40)
    assert.ok(weights.every((w) => w === weights[0]))
    const longer = rewindSlotWeights(FISHEYE_MIN_TURNS + 12, 11, 40)
    assert.ok(longer.some((w) => w !== longer[0]))
  })
})

describe('rewindCenters', () => {
  it('keeps centers inside the padded height and strictly increasing', () => {
    const centers = rewindCenters([4, 20, 8, 4], 200, 10)
    assert.equal(centers.length, 4)
    for (let i = 0; i < centers.length; i++) {
      assert.ok(centers[i]! >= 10)
      assert.ok(centers[i]! <= 190)
      if (i > 0) assert.ok(centers[i]! > centers[i - 1]!)
    }
  })
})

describe('dockMagnify', () => {
  it('peaks on the hovered index and falls to zero outside the radius', () => {
    assert.equal(dockMagnify(4, 4), 1)
    assert.ok(dockMagnify(5, 4) > 0)
    assert.ok(dockMagnify(5, 4) < dockMagnify(4, 4))
    assert.equal(dockMagnify(10, 4), 0)
    assert.equal(dockMagnify(4, null), 0)
  })
})

describe('rewindIndexAtY', () => {
  it('interpolates between neighboring centers', () => {
    assert.equal(rewindIndexAtY(0, [10, 30, 90]), 0)
    assert.equal(rewindIndexAtY(20, [10, 30, 90]), 0.5)
    assert.equal(rewindIndexAtY(90, [10, 30, 90]), 2)
    assert.equal(rewindIndexAtY(10, []), null)
  })
})

describe('layoutRewindRail', () => {
  it('fits every tick in a fixed height and magnifies the hover cluster', () => {
    const rows = layoutRewindRail({ count: 60, height: 400, focus: 12, hover: 12 })
    assert.equal(rows.length, 60)
    assert.ok(rows[12]!.tickW > rows[0]!.tickW)
    assert.ok(rows[12]!.tickH > rows[0]!.tickH)
    assert.ok(rows[12]!.labelOpacity > rows[13]!.labelOpacity)
    assert.ok(rows[0]!.labelOpacity < 0.05)
    assert.ok(rows[0]!.y < rows[59]!.y)
    assert.ok(rows[0]!.y >= 0)
    assert.ok(rows[59]!.y <= 400)
  })

  it('fades ticks with distance from the focus', () => {
    const rows = layoutRewindRail({ count: 40, height: 400, focus: 20, hover: null })
    assert.ok(rows[20]!.tickOpacity > rows[10]!.tickOpacity)
    assert.ok(rows[10]!.tickOpacity > rows[0]!.tickOpacity)
    assert.ok(rows[0]!.tickOpacity < 0.2)
  })

  it('hides labels when nothing is hovered', () => {
    const rows = layoutRewindRail({ count: 20, height: 300, focus: 4, hover: null })
    assert.ok(rows.every((row) => row.labelOpacity === 0))
  })

  it('names the hover cluster contiguously without overlapping plates', () => {
    const named = (rows: ReturnType<typeof layoutRewindRail>): number[] => {
      const plates = rows.filter((row) => row.labelOpacity > 0)
      for (let i = 1; i < plates.length; i++) {
        assert.ok(plates[i]!.y - plates[i - 1]!.y >= 18)
      }
      return plates.map((row) => row.index)
    }
    // Roomy rail: the whole magnified cluster is named.
    assert.deepEqual(named(layoutRewindRail({ count: 24, height: 520, focus: 12, hover: 12 })), [
      10, 11, 12, 13, 14
    ])
    // Squeezed rail: names stop where the plates would start to touch.
    assert.deepEqual(named(layoutRewindRail({ count: 60, height: 400, focus: 30, hover: 30 })), [
      29, 30, 31
    ])
  })

  it('keeps even spacing at rest and only opens the cluster while hovering', () => {
    const rest = layoutRewindRail({ count: 40, height: 400, focus: 20, hover: null })
    const gap = (rows: typeof rest, i: number): number => rows[i]!.y - rows[i - 1]!.y
    assert.ok(Math.abs(gap(rest, 20) - gap(rest, 2)) < 0.5)
    assert.equal(rest[0]!.tickW, rest[20]!.tickW)

    const hot = layoutRewindRail({ count: 40, height: 400, focus: 20, hover: 20 })
    assert.ok(gap(hot, 20) > gap(hot, 2))
    assert.ok(hot[20]!.tickW > hot[0]!.tickW)
    assert.equal(hot[0]!.tickW, rest[0]!.tickW)
  })

  it('names only the hovered turn when the cluster has no room to spread', () => {
    // 400 turns in 420px: magnified slots are ~9px apart, a plate is ~16px.
    const rows = layoutRewindRail({ count: 400, height: 420, focus: 200, hover: 200 })
    assert.deepEqual(
      rows.filter((row) => row.labelOpacity > 0).map((row) => row.index),
      [200]
    )
    // Magnification is unaffected — only the names thin out.
    assert.ok(rows[201]!.tickW > rows[190]!.tickW)
  })
})
