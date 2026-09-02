import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_CLI_AGENTS, DEFAULT_SETTINGS } from '../../../shared/types.ts'
import {
  inheritCreateWorkingDirectory,
  pickBootstrapActiveId,
  seedCliAgentCatalogue
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
})
