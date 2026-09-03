import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_CLI_AGENTS, DEFAULT_SETTINGS } from '../../../shared/types.ts'
import {
  inheritCreateWorkingDirectory,
  nextConversationForMachine,
  pickBootstrapActiveId,
  seedCliAgentCatalogue,
  seedEmptyConversationPatch,
  shouldSpawnDetachedConversation,
  claimDetachedSessionPatch
} from './sessionBootstrap.ts'

describe('sessionBootstrap', () => {
  it('keeps a live local session and otherwise picks the newest on this machine', () => {
    const rows = [
      { id: 'old', updatedAt: 1, machineId: 'local' },
      { id: 'new', updatedAt: 9, machineId: 'local' },
      { id: 'file', updatedAt: 20, fileId: 'f1', machineId: 'local' },
      { id: 'arch', updatedAt: 30, archived: true, machineId: 'local' },
      { id: 'remote', updatedAt: 40, machineId: 'other' }
    ]
    assert.equal(pickBootstrapActiveId(rows, 'old', 'local'), 'old')
    assert.equal(pickBootstrapActiveId(rows, 'missing', 'local'), 'new')
    assert.equal(pickBootstrapActiveId(rows, 'file', 'local'), 'new')
    assert.equal(pickBootstrapActiveId(rows, 'remote', 'local'), 'new')
    assert.deepEqual(nextConversationForMachine(rows, 'old', 'local'), { action: 'keep' })
    assert.deepEqual(nextConversationForMachine(rows, 'file', 'local'), {
      action: 'select',
      id: 'new'
    })
    assert.deepEqual(nextConversationForMachine(rows, 'missing', 'unknown'), { action: 'create' })
  })

  it('reseeds an empty CLI catalogue excluding removed ids', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      cliAgents: [],
      removedCliAgentIds: ['claude']
    }
    const { persistCliAgents } = seedCliAgentCatalogue(settings, DEFAULT_CLI_AGENTS)
    assert.equal(persistCliAgents, true)
    assert.ok(settings.cliAgents.length > 0)
    assert.equal(
      settings.cliAgents.some((agent) => agent.id === 'claude'),
      false
    )
  })

  it('fills missing model maps without rewriting a live catalogue', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      cliAgents: DEFAULT_CLI_AGENTS.map((agent) => ({
        ...agent,
        envVars: { ...agent.envVars },
        defaultArgs: [...agent.defaultArgs]
      })),
      disabledAgentModels: null as unknown as Record<string, string[]>,
      defaultAgentModels: null as unknown as Record<string, string>
    }
    const { persistCliAgents } = seedCliAgentCatalogue(settings, DEFAULT_CLI_AGENTS)
    assert.equal(persistCliAgents, false)
    assert.deepEqual(settings.disabledAgentModels, {})
    assert.deepEqual(settings.defaultAgentModels, {})
  })

  it('inherits a live project folder and skips temp / remote / pending paths', () => {
    const isTemporary = (path: string) => path.startsWith('/tmp')
    assert.equal(
      inheritCreateWorkingDirectory({
        active: { workingDirectory: '/proj', machineId: 'local' },
        activeMachine: 'local',
        isTemporary
      }),
      '/proj'
    )
    assert.equal(
      inheritCreateWorkingDirectory({
        active: { workingDirectory: '/tmp/scratch', machineId: 'local' },
        activeMachine: 'local',
        isTemporary
      }),
      undefined
    )
    assert.equal(
      inheritCreateWorkingDirectory({
        active: { workingDirectory: '/proj', machineId: 'other' },
        activeMachine: 'local',
        isTemporary
      }),
      undefined
    )
    assert.equal(
      inheritCreateWorkingDirectory({
        active: { workingDirectory: '__pending', machineId: 'local' },
        activeMachine: 'local',
        isTemporary
      }),
      undefined
    )
  })

  it('prepends a new conversation without duplicating an existing id', () => {
    const existing = { id: 'c1' }
    const seeded = seedEmptyConversationPatch(
      {
        conversations: [existing],
        messages: { c1: [{ id: 'm' }] },
        messagesHydrated: { c1: true },
        activeLeaf: { c1: 'm' }
      },
      { id: 'c2' }
    )
    assert.deepEqual(
      seeded.conversations.map((c) => c.id),
      ['c2', 'c1']
    )
    assert.deepEqual(seeded.messages.c2, [])
    assert.equal(seeded.messagesHydrated.c2, true)
    assert.equal(seeded.activeLeaf.c2, null)

    const again = seedEmptyConversationPatch(seeded, { id: 'c2' })
    assert.equal(again.conversations, seeded.conversations)
  })

  it('pins a claimed session and optionally seeds an empty transcript', () => {
    const existing = { id: 'c1' }
    const meta = { id: 'c2' }
    const tools = {
      toolsCollapsed: true,
      panelSegment: 'files' as const,
      lastActiveSegment: 'files' as const,
      panelHeight: 240
    }
    const claimed = claimDetachedSessionPatch(
      {
        conversations: [existing],
        messages: { c1: [{ id: 'm' }] },
        activeLeaf: { c1: 'm' }
      },
      meta,
      {
        knownEmpty: true,
        prevMessages: undefined,
        toolsLayouts: { c2: tools },
        activeTools: tools
      }
    )
    assert.equal(claimed.ready, true)
    assert.equal(claimed.activeId, 'c2')
    assert.deepEqual(claimed.selectedIds, ['c2'])
    assert.equal(claimed.pinnedConversationId, 'c2')
    assert.deepEqual(claimed.messages.c2, [])
    assert.equal(claimed.activeLeaf.c2, null)
    const live = claimDetachedSessionPatch(
      {
        conversations: [meta],
        messages: { c2: [{ id: 'keep' }] },
        activeLeaf: { c2: 'keep' }
      },
      meta,
      {
        knownEmpty: false,
        prevMessages: [{ id: 'old' }],
        toolsLayouts: {},
        activeTools: tools
      }
    )
    assert.deepEqual(live.messages.c2, [{ id: 'keep' }])
    assert.equal(live.activeLeaf.c2, 'keep')
  })

  it('spawns detached for explicit detached or a bound companion', () => {
    assert.equal(shouldSpawnDetachedConversation('detached', false), true)
    assert.equal(shouldSpawnDetachedConversation('here', true), false)
    assert.equal(shouldSpawnDetachedConversation(undefined, true), true)
    assert.equal(shouldSpawnDetachedConversation('none', false), false)
  })
})
