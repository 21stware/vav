import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  chatMessageFromRemoteThread,
  mergeAdoptedHostMessages,
  mergeRemoteThreadMessages,
  remoteControlTurnStatus,
  turnEventsFromRemoteThread,
  turnEventsFromRemoteTurn
} from './remoteControlApply.ts'
import type { ChatMessage } from './types.ts'

function user(id: string, text: string, parentId: string | null = null): ChatMessage {
  return {
    id,
    parentId,
    role: 'user',
    content: text,
    blocks: [{ kind: 'text', text }],
    createdAt: 1
  }
}

describe('mergeRemoteThreadMessages', () => {
  it('appends a host user turn the catalog has not caught yet', () => {
    const existing = [user('u0', 'older')]
    const merged = mergeRemoteThreadMessages(existing, [
      { id: 'u0', role: 'user', text: 'older', at: 1 },
      { id: 'u1', role: 'user', text: 'from master', at: 2 }
    ])
    assert.deepEqual(
      merged.messages.map((message) => message.id),
      ['u0', 'u1']
    )
    assert.equal(merged.added[0]?.content, 'from master')
    assert.equal(merged.added[0]?.parentId, 'u0')
    assert.equal(merged.leafId, 'u1')
  })

  it('keeps a local changeSetId when the phone thread omits it', () => {
    const existing: ChatMessage[] = [
      {
        ...user('a1', 'done'),
        role: 'assistant',
        changeSetId: 'cs1'
      }
    ]
    const merged = mergeRemoteThreadMessages(existing, [
      { id: 'a1', role: 'assistant', text: 'done', at: 1 }
    ])
    assert.equal(merged.messages[0]?.changeSetId, 'cs1')
    assert.equal(merged.added.length, 0)
  })
})

describe('turnEventsFromRemoteThread', () => {
  it('emits user events so the master transcript does not wait on hydrate', () => {
    const { events } = turnEventsFromRemoteThread(
      'local-1',
      [{ id: 'u1', role: 'user', text: 'ping from controller', at: 1 }],
      []
    )
    assert.equal(events[0]?.type, 'user')
    if (events[0]?.type !== 'user') return
    assert.equal(events[0].conversationId, 'local-1')
    assert.equal(events[0].message.content, 'ping from controller')
  })

  it('emits end only for a new assistant — a stale completed path must not stop a live turn', () => {
    const existing = [
      user('u0', 'hi'),
      { ...user('a0', 'old reply'), role: 'assistant' as const, parentId: 'u0' }
    ]
    const stale = turnEventsFromRemoteThread(
      'c1',
      [
        { id: 'u0', role: 'user', text: 'hi', at: 1 },
        { id: 'a0', role: 'assistant', text: 'old reply', at: 2 }
      ],
      existing
    )
    assert.equal(
      stale.events.some((event) => event.type === 'end'),
      false
    )

    const finished = turnEventsFromRemoteThread(
      'c1',
      [
        { id: 'u1', role: 'user', text: 'next', at: 3 },
        { id: 'a1', role: 'assistant', text: 'e2e stub reply', at: 4 }
      ],
      [user('u1', 'next')]
    )
    assert.equal(finished.events.some((event) => event.type === 'end'), true)
    const end = finished.events.find((event) => event.type === 'end')
    if (end?.type !== 'end') return
    assert.equal(end.message.content, 'e2e stub reply')
  })
})

describe('turnEventsFromRemoteTurn', () => {
  it('starts once, replaces the draft snapshot, and ends so running cannot stick', () => {
    const first = turnEventsFromRemoteTurn(
      'c1',
      { type: 'turn', conversationId: 'host-1', phase: 'running', draft: 'hel' },
      false
    )
    assert.equal(first.started, true)
    assert.equal(first.events[0]?.type, 'start')
    const delta = first.events.find((event) => event.type === 'delta')
    if (delta?.type !== 'delta') return
    assert.equal(delta.replace, true)
    assert.equal(delta.text, 'hel')

    const second = turnEventsFromRemoteTurn(
      'c1',
      { type: 'turn', conversationId: 'host-1', phase: 'running', draft: 'hello' },
      true
    )
    assert.equal(
      second.events.some((event) => event.type === 'start'),
      false
    )
    const replaced = second.events.find((event) => event.type === 'delta')
    if (replaced?.type !== 'delta') return
    assert.equal(replaced.text, 'hello')
    assert.equal(replaced.replace, true)

    const done = turnEventsFromRemoteTurn(
      'c1',
      { type: 'turn', conversationId: 'host-1', phase: 'done' },
      true
    )
    assert.equal(done.started, false)
    assert.equal(done.events[0]?.type, 'end')
    if (done.events[0]?.type !== 'end') return
    assert.equal(done.events[0].cancelled, false)
  })
})

describe('mergeAdoptedHostMessages', () => {
  it('keeps a live user turn a stale catalog snapshot omitted', () => {
    const incoming = [user('u0', 'older')]
    const existing = [user('u0', 'older'), user('u1', 'from master', 'u0')]
    const merged = mergeAdoptedHostMessages(incoming, existing)
    assert.deepEqual(
      merged.map((message) => message.id),
      ['u0', 'u1']
    )
    assert.equal(merged[1]?.content, 'from master')
  })
})

describe('remoteControlTurnStatus', () => {
  it('reports idle when the host is no longer generating', () => {
    const running = remoteControlTurnStatus({
      conversationId: 'c1',
      generating: true,
      liveBlocks: [{ kind: 'text', text: '…' }]
    })
    assert.equal(running.isRunning, true)
    assert.equal(running.phase, 'outputting')

    const idle = remoteControlTurnStatus({ conversationId: 'c1', generating: false })
    assert.equal(idle.isRunning, false)
    assert.equal(idle.phase, 'idle')
  })
})

describe('chatMessageFromRemoteThread', () => {
  it('projects tool and text blocks the phone already sends', () => {
    const message = chatMessageFromRemoteThread(
      {
        id: 'a1',
        role: 'assistant',
        text: 'done',
        at: 2,
        blocks: [
          { kind: 'tool', id: 't1', tool: 'fs_read', summary: 'read', status: 'completed' },
          { kind: 'text', text: 'done' }
        ]
      },
      'u1'
    )
    assert.equal(message.parentId, 'u1')
    assert.equal(message.blocks[0]?.kind, 'toolCall')
    if (message.blocks[0]?.kind !== 'toolCall') return
    assert.equal(message.blocks[0].status, 'completed')
  })
})
