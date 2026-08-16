import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { swatchPatternSize } from '../../../shared/surfacePattern.ts'

describe('swatchPatternSize', () => {
  it('leaves small tiles alone', () => {
    assert.equal(swatchPatternSize('20px'), '20px 20px')
    assert.equal(swatchPatternSize('24px 24px'), '24px 24px')
  })

  it('shrinks a tall wash tile so one cell fits the swatch', () => {
    assert.equal(swatchPatternSize('184px 208px'), '35px 40px')
  })
})
