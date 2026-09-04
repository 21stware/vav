import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { safeSend } from './safeSend.ts'

describe('safeSend', () => {
  it('sends when the frame is alive and skips a destroyed or missing frame', () => {
    const sent: { channel: string; payload: unknown }[] = []
    const live = {
      isDestroyed: () => false,
      send: (channel: string, payload?: unknown) => {
        sent.push({ channel, payload })
      }
    }
    safeSend(live, 'ping', { ok: true })
    safeSend(live, 'empty')
    safeSend({ isDestroyed: () => true, send: () => sent.push({ channel: 'no', payload: 1 }) }, 'x')
    safeSend(null, 'x')
    assert.deepEqual(sent, [
      { channel: 'ping', payload: { ok: true } },
      { channel: 'empty', payload: undefined }
    ])
  })

  it('swallows EPIPE from send without throwing', () => {
    const dying = {
      isDestroyed: () => false,
      send: () => {
        throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
      }
    }
    assert.doesNotThrow(() => safeSend(dying, 'late'))
  })
})
