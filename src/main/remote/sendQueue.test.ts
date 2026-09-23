import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RemoteSendQueue } from './sendQueue.ts'

describe('RemoteSendQueue', () => {
  it('queues while busy, drains when idle, and drops overflow', () => {
    const q = new RemoteSendQueue(2)
    const busy = new Set(['a'])
    q.enqueue('a', 'one', [])
    q.enqueue('a', 'two', ['x'], {
      appColumnFocus: {
        kind: 'data',
        level: 'item',
        title: 'sakila',
        path: '/tmp/sakila.db',
        objectId: 'db1',
        url: 'vav://app/data?id=db1'
      }
    })
    q.enqueue('a', 'three', [])
    assert.deepEqual(q.takeReady((id) => busy.has(id)), [])
    busy.delete('a')
    assert.deepEqual(q.takeReady(() => false), [{ conversationId: 'a', text: 'one', attachments: [] }])
    const second = q.takeReady(() => false)
    assert.equal(second[0]?.text, 'two')
    assert.equal(second[0]?.appColumnFocus?.kind, 'data')
    assert.deepEqual(q.takeReady(() => false), [])
    q.enqueue('b', 'x', [])
    q.clear('b')
    assert.deepEqual(q.takeReady(() => false), [])
  })
})
