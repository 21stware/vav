import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FALLBACK_SYSTEM_ACCENT, normalizeAccentHex } from './accentColor.ts'

describe('normalizeAccentHex', () => {
  it('accepts hashed, unhashed, and 8-digit OS strings', () => {
    assert.equal(normalizeAccentHex('007affaa'), '#007aff')
    assert.equal(normalizeAccentHex('#007affaa'), '#007aff')
    assert.equal(normalizeAccentHex('#007AFF'), '#007aff')
    assert.equal(normalizeAccentHex('  #112233  '), '#112233')
    assert.equal(normalizeAccentHex('not-a-color'), null)
    assert.equal(normalizeAccentHex(12), null)
    assert.equal(FALLBACK_SYSTEM_ACCENT, '#007aff')
  })
})
