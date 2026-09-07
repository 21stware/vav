import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CHROME_SOLID_RANGE, chromeSolidFromScroll } from './chromeSolid.ts'

describe('chromeSolidFromScroll', () => {
  it('is clear at the top', () => {
    assert.equal(chromeSolidFromScroll(0), 0)
    assert.equal(chromeSolidFromScroll(-4), 0)
  })

  it('ramps across the range', () => {
    assert.equal(chromeSolidFromScroll(CHROME_SOLID_RANGE / 2), 0.5)
    assert.equal(chromeSolidFromScroll(CHROME_SOLID_RANGE), 1)
    assert.equal(chromeSolidFromScroll(CHROME_SOLID_RANGE + 40), 1)
  })
})
