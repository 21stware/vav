import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mapRemoteSessions, REMOTE_SESSION_LIST_CAP, fallbackRemoteSession, buildRemoteThreadEvent } from './sessionList.ts'
import type { ChatMessage } from '../../shared/types.ts'

const msg = (id: string): ChatMessage => ({
  id,
  parentId: null,
  role: 'user',
  content: 'hi',
  blocks: [{ kind: 'text', text: 'hi' }],
  createdAt: 1
})

describe('mapRemoteSessions', () => {
  it('drops archived/file/swarm rows, sorts newest first, and caps the list', () => {
    const rows = Array.from({ length: REMOTE_SESSION_LIST_CAP + 3 }, (_, i) => ({
      id: `c${i}`,
      title: `S${i}`,
      updatedAt: i,
      messages: [msg(`m${i}`)],
      activeLeafId: `m${i}`,
      workingDirectory: '/tmp/vav'
    }))
    rows.push({
      id: 'archived',
      title: 'gone',
      archived: true,
      updatedAt: 999,
      messages: [],
      activeLeafId: null,
      workingDirectory: null
    })
    const listed = mapRemoteSessions(rows, {
      fallbackTitle: 'Session',
      tmpdir: '/tmp',
      dirLabel: () => '~',
      statusOf: () => 'idle',
      surfaceOf: () => 'vav'
    })
    assert.equal(listed.length, REMOTE_SESSION_LIST_CAP)
    assert.equal(listed[0]?.id, `c${REMOTE_SESSION_LIST_CAP + 2}`)
    assert.equal(listed.some((s) => s.id === 'archived'), false)
    assert.equal(listed[0]?.temporary, true)
  })

  it('puts pinned rows first and stamps favorite from the host set', () => {
    const listed = mapRemoteSessions(
      [
        { id: 'a', title: 'A', updatedAt: 30, messages: [msg('m1')], activeLeafId: 'm1' },
        {
          id: 'b',
          title: 'B',
          updatedAt: 1,
          messages: [msg('m2')],
          activeLeafId: 'm2',
          pinned: true,
          pinTime: 10
        },
        {
          id: 'c',
          title: 'C',
          updatedAt: 2,
          messages: [msg('m3')],
          activeLeafId: 'm3',
          pinned: true,
          pinTime: 20
        }
      ],
      {
        fallbackTitle: 'Session',
        tmpdir: '/tmp',
        dirLabel: () => '~',
        statusOf: () => 'idle',
        surfaceOf: () => 'vav',
        favoriteOf: (id) => id === 'a'
      }
    )
    assert.deepEqual(
      listed.map((row) => row.id),
      ['c', 'b', 'a']
    )
    assert.equal(listed[0]?.pinned, true)
    assert.equal(listed[2]?.favorite, true)
  })

  it('builds a create-session fallback row and hides archived threads', () => {
    const row = fallbackRemoteSession(
      { id: 'c1', title: '  ', updatedAt: 9 },
      { fallbackTitle: 'Session', dirLabel: '~/proj', surface: 'cli' }
    )
    assert.equal(row.title, 'Session')
    assert.equal(row.status, 'idle')
    assert.equal(row.surface, 'cli')
    assert.equal(row.dirLabel, '~/proj')
    const live = {
      archived: false,
      messages: [msg('m1')],
      activeLeafId: 'm1'
    }
    const thread = buildRemoteThreadEvent('c1', live, 'en')
    assert.equal(thread?.type, 'thread')
    assert.equal(thread?.conversationId, 'c1')
    assert.equal(thread?.messages[0]?.id, 'm1')
    assert.equal(buildRemoteThreadEvent('c1', { ...live, archived: true }, 'en'), null)
    assert.equal(buildRemoteThreadEvent('c1', null, 'en'), null)
  })
})
