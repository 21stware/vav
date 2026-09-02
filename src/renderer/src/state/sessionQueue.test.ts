import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { omitLiveUsage } from './sessionUsage.ts'
import { MESSAGE_QUEUE_MAX } from './sessionQueue.ts'

describe('omitLiveUsage', () => {
  it('drops one conversation without allocating when the id is missing', () => {
    const live = { a: { tokensUsed: 1 }, b: { tokensUsed: 2 } }
    assert.equal(omitLiveUsage(live, 'missing'), live)
    assert.deepEqual(omitLiveUsage(live, 'a'), { b: { tokensUsed: 2 } })
  })
})

describe('MESSAGE_QUEUE_MAX', () => {
  it('caps pending composer sends at 20', () => {
    assert.equal(MESSAGE_QUEUE_MAX, 20)
  })
})
