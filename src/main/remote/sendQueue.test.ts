import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RemoteSendQueue } from './sendQueue.ts'

describe('RemoteSendQueue', () => {
  it('queues while busy, drains when idle, and drops overflow', () => {
    const q = new RemoteSendQueue(2)
    const busy = new Set(['a'])
    q.enqueue('a', 'one', [])
    q.enqueue('a', 'two', ['x'])
    q.enqueue('a', 'three', [])
    assert.deepEqual(q.takeReady((id) => busy.has(id)), [])
    busy.delete('a')
    assert.deepEqual(q.takeReady(() => false), [{ conversationId: 'a', text: 'one', attachments: [] }])
    assert.deepEqual(q.takeReady(() => false), [{ conversationId: 'a', text: 'two', attachments: ['x'] }])
    assert.deepEqual(q.takeReady(() => false), [])
    q.enqueue('b', 'x', [])
    q.clear('b')
    assert.deepEqual(q.takeReady(() => false), [])
  })
})
