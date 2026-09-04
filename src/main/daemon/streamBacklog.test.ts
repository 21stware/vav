import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { enqueueStreamBacklog, STREAM_BACKLOG_CAP } from './DaemonClient.ts'

describe('enqueueStreamBacklog', () => {
  it('drops the oldest events when the cap is exceeded', () => {
    const queued: number[] = []
    for (let i = 0; i < 5; i++) enqueueStreamBacklog(queued, i, 3)
    assert.deepEqual(queued, [2, 3, 4])
  })

  it('keeps events under the default cap', () => {
    const queued: number[] = []
    enqueueStreamBacklog(queued, 1)
    assert.deepEqual(queued, [1])
    assert.ok(STREAM_BACKLOG_CAP >= 1)
  })
})
