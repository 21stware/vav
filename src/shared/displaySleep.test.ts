import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { displaysLookAsleep } from './displaySleep.ts'

describe('displaysLookAsleep', () => {
  it('is true with no displays', () => {
    assert.equal(displaysLookAsleep([]), true)
  })

  it('is true when every display is a 0-size stub', () => {
    assert.equal(displaysLookAsleep([{ bounds: { width: 0, height: 0 } }]), true)
    assert.equal(
      displaysLookAsleep([
        { bounds: { width: 0, height: 0 } },
        { bounds: { width: 1, height: 1 } }
      ]),
      true
    )
  })

  it('is false when any display has a real size', () => {
    assert.equal(displaysLookAsleep([{ bounds: { width: 1440, height: 900 } }]), false)
    assert.equal(
      displaysLookAsleep([
        { bounds: { width: 0, height: 0 } },
        { bounds: { width: 1280, height: 800 } }
      ]),
      false
    )
  })
})
