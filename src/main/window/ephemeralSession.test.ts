import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isDisposableEphemeralSession, liveDetachedConversationIds } from './ephemeralSession.ts'

function stale(
  partial: {
    messages?: unknown[]
    agentBinaryName?: string | null
    cliHost?: string | null
  } = {}
) {
  return {
    messages: partial.messages ?? [],
    agentBinaryName: partial.agentBinaryName,
    cliHost: partial.cliHost
  }
}

describe('isDisposableEphemeralSession', () => {
  it('disposes an empty vav shell with no CLI and no PTY', () => {
    assert.equal(isDisposableEphemeralSession(stale({ agentBinaryName: 'vav' }), false), true)
    assert.equal(isDisposableEphemeralSession(stale(), false), true)
  })

  it('keeps missing conversations, messages, CLI hosts, foreign agents, and PTYs', () => {
    assert.equal(isDisposableEphemeralSession(null, false), false)
    assert.equal(isDisposableEphemeralSession(stale({ messages: [{}] }), false), false)
    assert.equal(isDisposableEphemeralSession(stale({ cliHost: 'cursor' }), false), false)
    assert.equal(isDisposableEphemeralSession(stale({ agentBinaryName: 'claude' }), false), false)
    assert.equal(isDisposableEphemeralSession(stale({ agentBinaryName: 'vav' }), true), false)
  })
})

describe('liveDetachedConversationIds', () => {
  it('keeps live windows and skips destroyed or missing ones', () => {
    const win = (destroyed: boolean) => ({ isDestroyed: () => destroyed })
    assert.deepEqual(
      liveDetachedConversationIds([
        ['a', win(false)],
        ['b', win(true)],
        ['c', null],
        ['d', win(false)]
      ]),
      ['a', 'd']
    )
  })
})
