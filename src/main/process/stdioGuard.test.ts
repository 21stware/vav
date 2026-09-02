import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { ignoreEpipe, isIgnorableStreamError } from './stdioGuard.ts'

describe('isIgnorableStreamError', () => {
  it('matches EPIPE / destroyed-stream codes and messages', () => {
    assert.equal(isIgnorableStreamError({ code: 'EPIPE' }), true)
    assert.equal(isIgnorableStreamError({ code: 'ERR_STREAM_DESTROYED' }), true)
    assert.equal(isIgnorableStreamError(new Error('write EPIPE')), true)
    assert.equal(isIgnorableStreamError(new Error('ENOSPC')), false)
  })
})

describe('ignoreEpipe', () => {
  it('swallows EPIPE on a write stream without throwing', () => {
    const stream = new EventEmitter() as EventEmitter & {
      listenerCount: (event: string) => number
    }
    ignoreEpipe(stream as unknown as NodeJS.WriteStream)
    assert.doesNotThrow(() => stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })))
  })
})
