import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyRemoteServerMessage,
  emptyRemoteControlSession,
  remoteHello
} from './remoteControlSession.ts'
import { REMOTE_PROTO_VERSION, parseServerMessage } from './remoteControl.ts'

describe('remoteHello', () => {
  it('is a phone-role hello so LAN multiplex can hand the socket to the hub', () => {
    assert.deepEqual(remoteHello('secret-value-16+', 'iPhone'), {
      type: 'hello',
      proto: REMOTE_PROTO_VERSION,
      auth: 'secret-value-16+',
      device: 'iPhone',
      role: 'phone'
    })
  })
})

describe('applyRemoteServerMessage', () => {
  it('mirrors the iOS welcome → sessions → thread → turn-done path', () => {
    let state = emptyRemoteControlSession()
    state = applyRemoteServerMessage(state, {
      type: 'welcome',
      proto: 1,
      app: 'VAV',
      version: '1.18.6'
    })
    assert.equal(state.welcomed, true)
    state = applyRemoteServerMessage(state, {
      type: 'sessions',
      sessions: [
        {
          id: 'c1',
          title: 'Host chat',
          dirLabel: '~/proj',
          status: 'idle',
          surface: 'vav',
          updatedAt: 1
        }
      ]
    })
    assert.equal(state.sessions[0]?.title, 'Host chat')

    state = applyRemoteServerMessage(state, {
      type: 'turn',
      conversationId: 'c1',
      phase: 'running',
      draft: 'hello'
    })
    assert.deepEqual(state.generatingIds, ['c1'])
    assert.equal(state.drafts.c1, 'hello')
    assert.equal(state.sessions[0]?.status, 'running')

    state = applyRemoteServerMessage(state, {
      type: 'thread',
      conversationId: 'c1',
      messages: [
        { id: 'u1', role: 'user', text: 'hi', at: 1 },
        { id: 'a1', role: 'assistant', text: 'hello', at: 2 }
      ]
    })
    assert.equal(state.threads.c1?.length, 2)
    assert.deepEqual(state.generatingIds, [])
    assert.equal(state.drafts.c1, undefined)
  })

  it('parses the same wire frames the phone accepts', () => {
    const parsed = parseServerMessage({
      type: 'turn',
      conversationId: 'c1',
      phase: 'running',
      draft: '…',
      blocks: [{ kind: 'text', text: '…' }]
    })
    assert.equal(parsed?.type, 'turn')
    if (parsed?.type !== 'turn') return
    const state = applyRemoteServerMessage(emptyRemoteControlSession(), parsed)
    assert.equal(state.liveBlocks.c1?.[0]?.kind, 'text')
  })

  it('clears generating when the host reports an error', () => {
    let state = emptyRemoteControlSession()
    state = applyRemoteServerMessage(state, {
      type: 'turn',
      conversationId: 'c1',
      phase: 'running'
    })
    state = applyRemoteServerMessage(state, {
      type: 'error',
      code: 'not-found',
      message: 'no such conversation',
      conversationId: 'c1'
    })
    assert.deepEqual(state.generatingIds, [])
    assert.equal(state.lastError?.code, 'not-found')
  })
})
