import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { zwjCharProperties } from './terminalUnicode.ts'

const ZWJ = 0x200d
const SMILE = 0x1f600
const GEAR = 0x2699

function props(kind: number, width: 0 | 1 | 2, join = false): number {
  return ((kind & 0xffffff) << 3) | ((width & 3) << 1) | (join ? 1 : 0)
}

describe('zwjCharProperties', () => {
  it('keeps ZWJ on the preceding glyph width', () => {
    const preceding = props(SMILE, 2)
    const next = zwjCharProperties(ZWJ, preceding, () => 0, () => 0)
    assert.equal((next >> 1) & 3, 2)
    assert.equal(next & 1, 1)
  })

  it('does not advance a second cell for the emoji after ZWJ', () => {
    const afterZwj = props(ZWJ, 2, true)
    const next = zwjCharProperties(GEAR, afterZwj, () => 1, () => 99)
    assert.equal((next >> 1) & 3, 2)
    assert.equal(next & 1, 1)
    assert.notEqual(next, 99)
  })

  it('defers to the base table when there is no ZWJ', () => {
    const preceding = props(SMILE, 2)
    assert.equal(
      zwjCharProperties(GEAR, preceding, () => 1, () => 42),
      42
    )
  })
})
