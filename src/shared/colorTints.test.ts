import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeAccentHex } from './colorTints.ts'

describe('normalizeAccentHex', () => {
  it('accepts #rrggbb and lowercases', () => {
    assert.equal(normalizeAccentHex('#D97757'), '#d97757')
  })

  it('accepts rrggbb without a hash', () => {
    assert.equal(normalizeAccentHex('7c6bc4'), '#7c6bc4')
  })

  it('rejects empty, short, and non-hex values', () => {
    assert.equal(normalizeAccentHex(''), null)
    assert.equal(normalizeAccentHex('   '), null)
    assert.equal(normalizeAccentHex('#fff'), null)
    assert.equal(normalizeAccentHex('not-a-color'), null)
    assert.equal(normalizeAccentHex(undefined), null)
  })
})
