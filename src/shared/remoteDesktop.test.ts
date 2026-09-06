import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  chatMessagesFromRemoteThread,
  conversationFromRemoteSession,
  favoriteIdsFromRemoteSessions,
  messageBlockFromRemote,
  turnEventsFromRemoteTurn,
  userTurnEvent
} from './remoteDesktop.ts'

describe('remoteDesktop (phone → desktop session model)', () => {
  it('maps a phone session row onto ConversationMeta the sidebar already paints', () => {
    const meta = conversationFromRemoteSession(
      {
        id: 's1',
        title: 'One',
        dirLabel: '~/vav',
        status: 'idle',
        surface: 'vav',
        updatedAt: 10,
        workdir: '/tmp/vav',
        pinned: true,
        pinTime: 9,
        favorite: true
      },
      {
        type: 'controls',
        conversationId: 's1',
        agentLocked: true,
        agent: 'vav',
        agents: [{ id: 'vav', label: 'VAV' }],
        model: 'opus',
        models: [{ id: 'opus', label: 'Opus' }],
        thinking: 'high',
        thinkingLevels: [{ id: 'high', label: '高' }],
        mode: null,
        modes: [],
        approval: 'bypass',
        approvals: [],
        fast: null,
        workingDirectory: '/tmp/vav',
        dirLabel: '~/vav',
        temporary: true
      }
    )
    assert.equal(meta.id, 's1')
    assert.equal(meta.model, 'opus')
    assert.equal(meta.approvalMode, 'bypass')
    assert.equal(meta.thinkingLevel, 'high')
    assert.equal(meta.pinned, true)
    assert.equal(meta.cliHost, null)
    assert.deepEqual(
      favoriteIdsFromRemoteSessions([
        {
          id: 's1',
          title: 'One',
          dirLabel: '~/vav',
          status: 'idle',
          surface: 'vav',
          updatedAt: 10,
          favorite: true
        }
      ]),
      ['s1']
    )
  })

  it('rebuilds a linear ChatMessage path with You / Agent blocks', () => {
    const path = chatMessagesFromRemoteThread([
      { id: 'u', role: 'user', text: 'hi', at: 1 },
      {
        id: 'a',
        role: 'assistant',
        text: 'ok',
        at: 2,
        blocks: [
          { kind: 'reasoning', text: 'ponder' },
          { kind: 'tool', id: 't1', tool: 'fs_read', name: 'Read', summary: 'a.ts', status: 'completed' },
          { kind: 'text', text: 'ok' }
        ]
      }
    ])
    assert.equal(path.length, 2)
    assert.equal(path[0]!.parentId, null)
    assert.equal(path[1]!.parentId, 'u')
    assert.equal(path[1]!.blocks[0]!.kind, 'reasoning')
    assert.equal(path[1]!.blocks[1]!.kind, 'toolCall')
    assert.equal(path[1]!.blocks[2]!.kind, 'text')
  })

  it('turns a live phone turn into desktop start/delta/tool events', () => {
    const events = turnEventsFromRemoteTurn({
      type: 'turn',
      conversationId: 's1',
      phase: 'running',
      blocks: [
        { kind: 'reasoning', text: 'think' },
        { kind: 'text', text: 'hello' }
      ]
    })
    assert.equal(events[0]!.type, 'start')
    assert.equal(events[1]!.type, 'delta')
    assert.equal(events[2]!.type, 'delta')
    const user = userTurnEvent('s1', 'hi')
    assert.equal(user.type, 'user')
  })

  it('maps awaiting cards onto desktop toolCall blocks', () => {
    const block = messageBlockFromRemote({
      kind: 'awaiting',
      id: 'ask-1',
      tool: 'ask_user_question',
      title: 'Pick',
      prompt: 'Which?',
      choices: [{ id: 'a', label: 'A' }]
    })
    assert.ok(block)
    assert.equal(block.kind, 'toolCall')
    assert.equal(block.status, 'pending')
    assert.deepEqual(block.choices, ['A'])
  })
})
