import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fanRemoteTurn, type RemoteTurnSink } from './fanTurn.ts'

function sink(): RemoteTurnSink & {
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    beginLive(id) {
      calls.push(`begin:${id}`)
    },
    appendLive(id, index, kind, text) {
      calls.push(`append:${id}:${index}:${kind}:${text}`)
    },
    setLiveBlock(id, index) {
      calls.push(`block:${id}:${index}`)
    },
    finishTurn(id, status, error) {
      calls.push(`end:${id}:${status}:${error ?? ''}`)
    }
  }
}

describe('fanRemoteTurn', () => {
  it('starts, appends text, and finishes success or error', () => {
    const remote = sink()
    fanRemoteTurn({ type: 'start', conversationId: 'c1' } as never, remote, 'en')
    fanRemoteTurn(
      { type: 'delta', conversationId: 'c1', index: 0, kind: 'text', text: 'hi' } as never,
      remote,
      'en'
    )
    fanRemoteTurn({ type: 'end', conversationId: 'c1', cancelled: false } as never, remote, 'en')
    fanRemoteTurn(
      { type: 'end', conversationId: 'c1', cancelled: false, error: 'boom' } as never,
      remote,
      'en'
    )
    fanRemoteTurn({ type: 'end', conversationId: 'c1', cancelled: true } as never, remote, 'en')
    assert.deepEqual(remote.calls, [
      'begin:c1',
      'append:c1:0:text:hi',
      'end:c1:done:',
      'end:c1:error:boom',
      'end:c1:cancelled:'
    ])
  })
})
