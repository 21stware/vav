import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  compareRemoteSessions,
  drainJsonLines,
  encodeLine,
  encodePairing,
  parseClientMessage,
  parsePairing,
  parseServerMessage
} from './remoteControl.ts'

describe('drainJsonLines', () => {
  it('parses complete lines and keeps the partial tail', () => {
    const { values, rest } = drainJsonLines('{"type":"ping"}\n{"type":"sess')
    assert.deepEqual(values, [{ type: 'ping' }])
    assert.equal(rest, '{"type":"sess')
  })

  it('handles several lines in one chunk and skips blanks', () => {
    const { values, rest } = drainJsonLines('{"a":1}\n\n{"b":2}\n')
    assert.deepEqual(values, [{ a: 1 }, { b: 2 }])
    assert.equal(rest, '')
  })

  it('surfaces invalid JSON as null instead of throwing', () => {
    const { values } = drainJsonLines('not json\n{"ok":true}\n')
    assert.deepEqual(values, [null, { ok: true }])
  })

  it('round-trips encodeLine output', () => {
    const { values, rest } = drainJsonLines(encodeLine({ type: 'ping' }))
    assert.deepEqual(values, [{ type: 'ping' }])
    assert.equal(rest, '')
  })
})

describe('parseClientMessage', () => {
  it('accepts a well-formed hello', () => {
    const msg = parseClientMessage({ type: 'hello', proto: 1, auth: 's', device: 'iPhone' })
    assert.deepEqual(msg, { type: 'hello', proto: 1, auth: 's', device: 'iPhone' })
  })

  it('keeps a daemon-role hello on the phone parser so the tunnel can hand off', () => {
    const msg = parseClientMessage({
      type: 'hello',
      proto: 1,
      auth: 's',
      device: 'vavd',
      role: 'daemon'
    })
    assert.deepEqual(msg, {
      type: 'hello',
      proto: 1,
      auth: 's',
      device: 'vavd',
      role: 'daemon'
    })
  })

  it('rejects hello without auth or proto', () => {
    assert.equal(parseClientMessage({ type: 'hello', proto: 1 }), null)
    assert.equal(parseClientMessage({ type: 'hello', auth: 's' }), null)
    assert.equal(parseClientMessage({ type: 'hello', proto: 1, auth: '' }), null)
  })

  it('accepts send with conversation and non-blank text', () => {
    const msg = parseClientMessage({ type: 'send', conversationId: 'c1', text: 'hi' })
    assert.deepEqual(msg, { type: 'send', conversationId: 'c1', text: 'hi' })
  })

  it('accepts send with images and a blank caption', () => {
    const msg = parseClientMessage({
      type: 'send',
      conversationId: 'c1',
      text: '  ',
      images: [{ name: 'shot.jpg', mime: 'image/jpeg', data: 'abc' }]
    })
    assert.deepEqual(msg, {
      type: 'send',
      conversationId: 'c1',
      text: '  ',
      images: [{ name: 'shot.jpg', mime: 'image/jpeg', data: 'abc' }]
    })
  })

  it('rejects send with blank text or missing conversation', () => {
    assert.equal(parseClientMessage({ type: 'send', conversationId: 'c1', text: '  ' }), null)
    assert.equal(parseClientMessage({ type: 'send', text: 'hi' }), null)
    assert.equal(
      parseClientMessage({
        type: 'send',
        conversationId: 'c1',
        text: '',
        images: [{ name: 'x', mime: 'image/gif', data: 'abc' }]
      }),
      null
    )
  })

  it('rejects unknown types and non-objects', () => {
    assert.equal(parseClientMessage({ type: 'nope' }), null)
    assert.equal(parseClientMessage('hello'), null)
    assert.equal(parseClientMessage(null), null)
  })

  it('passes through sessions, create, and ping', () => {
    assert.deepEqual(parseClientMessage({ type: 'sessions' }), { type: 'sessions' })
    assert.deepEqual(parseClientMessage({ type: 'create' }), { type: 'create' })
    assert.deepEqual(parseClientMessage({ type: 'ping' }), { type: 'ping' })
  })

  it('accepts a thread request', () => {
    assert.deepEqual(parseClientMessage({ type: 'thread', conversationId: 'c1' }), {
      type: 'thread',
      conversationId: 'c1'
    })
    assert.equal(parseClientMessage({ type: 'thread', conversationId: '' }), null)
  })

  it('accepts controls and configure', () => {
    assert.deepEqual(parseClientMessage({ type: 'controls', conversationId: 'c1' }), {
      type: 'controls',
      conversationId: 'c1'
    })
    assert.deepEqual(
      parseClientMessage({
        type: 'configure',
        conversationId: 'c1',
        model: 'grok-4',
        thinkingLevel: 'high'
      }),
      { type: 'configure', conversationId: 'c1', model: 'grok-4', thinkingLevel: 'high' }
    )
    assert.equal(parseClientMessage({ type: 'configure', conversationId: 'c1' }), null)
  })

  it('accepts pin and favorite toggles', () => {
    assert.deepEqual(parseClientMessage({ type: 'pin', conversationId: 'c1', pinned: true }), {
      type: 'pin',
      conversationId: 'c1',
      pinned: true
    })
    assert.deepEqual(parseClientMessage({ type: 'favorite', conversationId: 'c1', favorite: false }), {
      type: 'favorite',
      conversationId: 'c1',
      favorite: false
    })
    assert.equal(parseClientMessage({ type: 'pin', conversationId: 'c1' }), null)
    assert.equal(parseClientMessage({ type: 'favorite', conversationId: 'c1' }), null)
  })

  it('accepts cancel, reply, rename, archive, browse, workspace, and fast', () => {
    assert.deepEqual(parseClientMessage({ type: 'cancel', conversationId: 'c1' }), {
      type: 'cancel',
      conversationId: 'c1'
    })
    assert.deepEqual(
      parseClientMessage({ type: 'reply', conversationId: 'c1', toolCallId: 't1', answer: 'yes' }),
      { type: 'reply', conversationId: 'c1', toolCallId: 't1', answer: 'yes' }
    )
    assert.deepEqual(parseClientMessage({ type: 'rename', conversationId: 'c1', title: '  Hello  ' }), {
      type: 'rename',
      conversationId: 'c1',
      title: 'Hello'
    })
    assert.deepEqual(parseClientMessage({ type: 'archive', conversationId: 'c1' }), {
      type: 'archive',
      conversationId: 'c1'
    })
    assert.deepEqual(parseClientMessage({ type: 'browse', conversationId: 'c1' }), {
      type: 'browse',
      conversationId: 'c1'
    })
    assert.deepEqual(
      parseClientMessage({ type: 'workspace', conversationId: 'c1', temp: true }),
      { type: 'workspace', conversationId: 'c1', temp: true }
    )
    assert.deepEqual(
      parseClientMessage({ type: 'configure', conversationId: 'c1', fast: true }),
      { type: 'configure', conversationId: 'c1', fast: true }
    )
    assert.equal(parseClientMessage({ type: 'workspace', conversationId: 'c1' }), null)
    assert.equal(parseClientMessage({ type: 'reply', conversationId: 'c1', toolCallId: 't1', answer: '  ' }), null)
  })
})

describe('compareRemoteSessions', () => {
  it('puts pinned rows first, newest pin first, then recency', () => {
    const rows = [
      { pinned: false, pinTime: 0, updatedAt: 30 },
      { pinned: true, pinTime: 10, updatedAt: 1 },
      { pinned: true, pinTime: 20, updatedAt: 2 },
      { pinned: false, pinTime: 0, updatedAt: 40 }
    ]
    const sorted = [...rows].sort(compareRemoteSessions)
    assert.deepEqual(
      sorted.map((row) => row.pinTime || row.updatedAt),
      [20, 10, 40, 30]
    )
  })
})

describe('pairing payload', () => {
  it('round-trips through encode/parse', () => {
    const encoded = encodePairing({
      v: 1,
      token: 'tcABCDEF',
      secret: '0123456789abcdef0123456789abcdef',
      host: 'MacBook'
    })
    const parsed = parsePairing(encoded)
    assert.ok(parsed)
    assert.equal(parsed.token, 'tcABCDEF')
    assert.equal(parsed.secret, '0123456789abcdef0123456789abcdef')
    assert.equal(parsed.host, 'MacBook')
  })

  it('rejects foreign schemes, short secrets, and bad tokens', () => {
    assert.equal(parsePairing('https://example.com'), null)
    assert.equal(
      parsePairing(`vav-remote:${JSON.stringify({ v: 1, token: 'tcA', secret: 'short' })}`),
      null
    )
    assert.equal(
      parsePairing(
        `vav-remote:${JSON.stringify({ v: 1, token: 'nottc', secret: '0123456789abcdef' })}`
      ),
      null
    )
    assert.equal(parsePairing('vav-remote:{broken'), null)
  })
})

describe('parseServerMessage', () => {
  it('accepts welcome, sessions, thread, and turn frames the phone already paints', () => {
    assert.deepEqual(parseServerMessage({ type: 'welcome', proto: 1, app: 'VAV', version: '1' }), {
      type: 'welcome',
      proto: 1,
      app: 'VAV',
      version: '1'
    })
    const sessions = parseServerMessage({
      type: 'sessions',
      sessions: [{ id: 'c1', title: 'Host', status: 'idle', surface: 'vav', updatedAt: 1 }]
    })
    assert.equal(sessions?.type, 'sessions')
    if (sessions?.type === 'sessions') assert.equal(sessions.sessions[0]?.dirLabel, '')
    const turn = parseServerMessage({
      type: 'turn',
      conversationId: 'c1',
      phase: 'running',
      draft: 'hi',
      blocks: [{ kind: 'text', text: 'hi' }]
    })
    assert.equal(turn?.type, 'turn')
    if (turn?.type === 'turn') assert.equal(turn.draft, 'hi')
  })

  it('rejects a turn without a conversation', () => {
    assert.equal(parseServerMessage({ type: 'turn', phase: 'running' }), null)
  })
})
