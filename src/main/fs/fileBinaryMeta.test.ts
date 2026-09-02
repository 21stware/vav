import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { inodeLabel, ownerLabel, statTimeMs } from './fileBinaryMeta.ts'

describe('statTimeMs', () => {
  it('prefers a finite millisecond field, then Date', () => {
    assert.equal(statTimeMs(12.5), 12.5)
    assert.equal(statTimeMs(Number.NaN, new Date(1000)), 1000)
    assert.equal(statTimeMs(undefined, undefined), null)
  })
})

describe('inodeLabel / ownerLabel', () => {
  it('dashes missing inode and unknown uid', () => {
    assert.equal(inodeLabel(undefined), '—')
    assert.equal(inodeLabel(null), '—')
    assert.equal(inodeLabel(42n), '42')
    assert.equal(ownerLabel(-1), '—')
    assert.equal(ownerLabel(501), '501')
    assert.equal(ownerLabel(501, { uid: 501, username: 'ada' }), 'ada')
    assert.equal(ownerLabel(502, { uid: 501, username: 'ada' }), '502')
  })
})
