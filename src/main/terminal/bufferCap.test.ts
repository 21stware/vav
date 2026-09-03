import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { appendCapped } from './bufferCap.ts'

describe('appendCapped', () => {
  it('keeps the tail when the cap is exceeded', () => {
    const { buffer, dropped } = appendCapped('aaaa', 'bbbb', 6)
    assert.equal(buffer, 'aabbbb')
    assert.equal(dropped, 2)
  })

  it('does not drop under the cap', () => {
    const { buffer, dropped } = appendCapped('aa', 'bb', 10)
    assert.equal(buffer, 'aabb')
    assert.equal(dropped, 0)
  })
})
