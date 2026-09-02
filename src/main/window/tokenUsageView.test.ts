import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveContextTokens, tokenUsagePopupPosition } from './tokenUsageView.ts'

describe('resolveContextTokens', () => {
  it('prefers compaction estimate, then last input, then tokensUsed', () => {
    assert.deepEqual(resolveContextTokens(40, 10, 2), {
      contextTokens: 40,
      contextTokensEstimated: true
    })
    assert.deepEqual(resolveContextTokens(0, 10, 2), {
      contextTokens: 10,
      contextTokensEstimated: false
    })
    assert.deepEqual(resolveContextTokens(0, 0, 2), {
      contextTokens: 2,
      contextTokensEstimated: false
    })
  })
})

describe('tokenUsagePopupPosition', () => {
  const content = { x: 100, y: 50, width: 800, height: 600 }
  const workArea = { x: 0, y: 0, width: 1440, height: 900 }

  it('sits above the ring and clamps into the work area', () => {
    const pos = tokenUsagePopupPosition({
      width: 320,
      height: 80,
      content,
      workArea,
      anchor: { x: 700, y: 100, width: 28, height: 28 }
    })
    assert.deepEqual(pos, { x: 508, y: 62 })
  })

  it('falls below the ring when there is no room above', () => {
    const pos = tokenUsagePopupPosition({
      width: 320,
      height: 240,
      content,
      workArea,
      anchor: { x: 10, y: 4, width: 28, height: 28 }
    })
    assert.equal(pos.y, 90)
    assert.equal(pos.x, 8)
  })
})
