import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  agentBinaryCandidates,
  agentWebsiteUrl,
  newlyInstalledCatalogueAgents
} from './agentBinary.ts'
import type { AgentConfig } from './types.ts'

function fakeAgent(id: string, extras?: Partial<AgentConfig>): AgentConfig {
  return {
    id,
    name: id,
    binaryPath: id,
    defaultArgs: [],
    envVars: {},
    enabled: true,
    ...extras
  }
}

describe('agentBinaryCandidates', () => {
  it('merges row + catalogue names without duplicates', () => {
    const list = agentBinaryCandidates(
      {
        id: 'grok',
        binaryPath: 'grok',
        binaryCandidates: ['grok', 'grok-build']
      },
      [{ id: 'grok', binaryPath: 'grok', binaryCandidates: ['grok'] }]
    )
    assert.ok(list.includes('grok'))
    assert.ok(list.includes('grok-build'))
    assert.equal(new Set(list).size, list.length)
  })
})

describe('agentWebsiteUrl', () => {
  it('accepts http(s) docs urls and rejects empty / relative', () => {
    assert.equal(agentWebsiteUrl({ installDocsUrl: 'https://opencode.ai/docs/' }), 'https://opencode.ai/docs/')
    assert.equal(agentWebsiteUrl({ installDocsUrl: '  ' }), null)
    assert.equal(agentWebsiteUrl({ installDocsUrl: '/local' }), null)
    assert.equal(agentWebsiteUrl({}), null)
  })
})

describe('newlyInstalledCatalogueAgents', () => {
  const catalogue = [fakeAgent('claude'), fakeAgent('grok'), fakeAgent('opencode'), fakeAgent('cursor')]

  it('appends catalogue agents that are installed and not already listed', () => {
    const added = newlyInstalledCatalogueAgents(
      ['claude', 'grok'],
      {
        claude: '/usr/bin/claude',
        grok: '/usr/bin/grok',
        opencode: '/usr/local/bin/opencode',
        cursor: null
      },
      catalogue
    )
    assert.deepEqual(
      added.map((a) => a.id),
      ['opencode']
    )
    assert.equal(added[0]?.enabled, true)
    assert.equal(added[0]?.builtin, true)
  })

  it('returns nothing when every installed catalogue row is already present', () => {
    const ids = catalogue.map((a) => a.id)
    const installed = Object.fromEntries(ids.map((id) => [id, `/bin/${id}`]))
    assert.deepEqual(newlyInstalledCatalogueAgents(ids, installed, catalogue), [])
  })

  it('does not re-attach catalogue agents the user removed', () => {
    const added = newlyInstalledCatalogueAgents(
      ['claude'],
      {
        claude: '/usr/bin/claude',
        grok: '/usr/bin/grok',
        opencode: '/usr/local/bin/opencode',
        cursor: '/usr/bin/cursor'
      },
      catalogue,
      ['grok', 'cursor']
    )
    assert.deepEqual(
      added.map((a) => a.id),
      ['opencode']
    )
  })
})
