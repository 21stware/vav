import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  acpSessionFromControls,
  chatMessagesFromRemoteThread,
  conversationFromRemoteSession,
  conversationListPatchFromRemoteSession,
  desktopRemoteSessionApply,
  isSparseRemoteConversation,
  favoriteIdsFromRemoteSessions,
  messageBlockFromRemote,
  turnEventsFromRemoteTurn,
  userTurnEvent
} from './remoteDesktop.ts'

describe('remoteDesktop (phone → desktop session model)', () => {
  it('treats a sessions list row as sparse — no model, no thread, no tokens', () => {
    assert.equal(
      isSparseRemoteConversation({ model: '', messages: [], tokensUsed: 0, tokenLimit: 0 }),
      true
    )
    assert.equal(isSparseRemoteConversation({ model: 'unknown', messages: [] }), true)
    assert.equal(
      isSparseRemoteConversation({ model: 'grok-4.6', messages: [], tokensUsed: 0, tokenLimit: 0 }),
      false
    )
  })

  it('patches pin/title from a sessions row without inventing model or host', () => {
    const patch = conversationListPatchFromRemoteSession({
      id: 's1',
      title: 'Renamed',
      dirLabel: '~/vav',
      status: 'idle',
      surface: 'vav',
      updatedAt: 20,
      workdir: '/tmp/vav',
      pinned: true,
      pinTime: 19
    })
    assert.equal(patch.title, 'Renamed')
    assert.equal(patch.pinned, true)
    assert.equal(patch.workingDirectory, '/tmp/vav')
    assert.equal(patch.model, undefined)
    assert.equal(patch.cliHost, undefined)
  })

  it('keeps the live model when a sessions broadcast lands after configure', () => {
    const result = desktopRemoteSessionApply(
      {
        id: 's1',
        title: 'One',
        dirLabel: '~/vav',
        status: 'idle',
        surface: 'cli',
        updatedAt: 20,
        pinned: true,
        pinTime: 19
      },
      {
        existing: { model: 'grok-4.6', cliHost: 'cursor', agentBinaryName: 'cursor' },
        existingIsLocal: false,
        adoptAsLocal: false
      }
    )
    assert.equal(result.kind, 'patch')
    if (result.kind !== 'patch') return
    assert.equal(result.patch.model, undefined)
    assert.equal(result.patch.cliHost, undefined)
    assert.equal(result.patch.pinned, true)
  })

  it('does not project a paired-remote list row onto a local workbench id', () => {
    const result = desktopRemoteSessionApply(
      {
        id: 's1',
        title: 'Host',
        dirLabel: '',
        status: 'idle',
        surface: 'vav',
        updatedAt: 1
      },
      {
        existing: { model: 'grok-4.6', cliHost: 'cursor', agentBinaryName: 'cursor' },
        existingIsLocal: true,
        adoptAsLocal: false
      }
    )
    assert.equal(result.kind, 'skip')
  })

  it('still seeds model from controls when minting a new remote row', () => {
    const result = desktopRemoteSessionApply(
      {
        id: 's1',
        title: 'One',
        dirLabel: '~/vav',
        status: 'idle',
        surface: 'cli',
        updatedAt: 20
      },
      {
        controls: {
          type: 'controls',
          conversationId: 's1',
          agentLocked: true,
          agent: 'cursor',
          agents: [],
          model: 'grok-4.6',
          models: [{ id: 'grok-4.6', label: 'Grok 4.6' }],
          thinking: null,
          thinkingLevels: [],
          mode: null,
          modes: [],
          approval: 'auto',
          approvals: [],
          fast: false,
          workingDirectory: '/tmp',
          dirLabel: 'tmp',
          temporary: true
        }
      }
    )
    assert.equal(result.kind, 'adopt')
    if (result.kind !== 'adopt') return
    assert.equal(result.meta.model, 'grok-4.6')
    assert.equal(result.meta.cliHost, 'cursor')
  })

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

  it('projects host recovery chrome so Chrome matches the desktop stream status', () => {
    const events = turnEventsFromRemoteTurn({
      type: 'turn',
      conversationId: 's1',
      phase: 'running',
      draft: 'partial e2e reply',
      recovery: { kind: 'healing', attempt: 1, limit: 3 }
    })
    const phase = events.find((event) => event.type === 'phase')
    assert.equal(phase?.type === 'phase' ? phase.phase : null, 'healing')
    assert.deepEqual(phase?.type === 'phase' ? phase.recovery : null, {
      kind: 'healing',
      attempt: 1,
      limit: 3
    })
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

  it('maps control-plane modes and slash commands onto acpSession', () => {
    const state = acpSessionFromControls({
      type: 'controls',
      conversationId: 's1',
      agentLocked: true,
      agent: 'cursor',
      agents: [],
      model: 'grok-4.6',
      models: [],
      thinking: null,
      thinkingLevels: [],
      mode: 'agent',
      modes: [{ id: 'agent', label: 'Agent' }],
      commands: [
        { id: 'compact', label: 'Compact this session' },
        { id: 'cost', label: 'Show session cost' }
      ],
      approval: 'auto',
      approvals: [],
      fast: false,
      workingDirectory: '/tmp',
      dirLabel: 'tmp',
      temporary: true
    })
    assert.equal(state?.currentModeId, 'agent')
    assert.deepEqual(
      state?.commands?.map((row) => row.name),
      ['compact', 'cost']
    )
  })
})
