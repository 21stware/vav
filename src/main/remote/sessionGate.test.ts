import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  remoteCatalogModelRows,
  remoteControlAgentRows,
  remoteDefaultApproval,
  remoteHostRecentDirs,
  remoteLiveConversation
} from './sessionGate.ts'

describe('remoteLiveConversation', () => {
  it('gates missing and archived sessions', () => {
    assert.equal(remoteLiveConversation(null), 'not-found')
    assert.equal(remoteLiveConversation({ archived: true }), 'archived')
    assert.equal(remoteLiveConversation({ archived: false }), 'ok')
  })
})

describe('remoteHostRecentDirs', () => {
  it('dedupes pinned+recent, skips missing, and respects the cap', () => {
    const dirs = remoteHostRecentDirs(['/pin', '/shared', '/gone'], ['/shared', '/recent', '/also'], {
      exists: (path) => path !== '/gone',
      label: (path) => path.slice(1),
      cap: 3
    })
    assert.deepEqual(dirs, [
      { path: '/pin', label: 'pin' },
      { path: '/shared', label: 'shared' },
      { path: '/recent', label: 'recent' }
    ])
  })
})

describe('remoteDefaultApproval', () => {
  it('keeps bypass/edit and maps everything else to auto', () => {
    assert.equal(remoteDefaultApproval('bypass'), 'bypass')
    assert.equal(remoteDefaultApproval('edit'), 'edit')
    assert.equal(remoteDefaultApproval('auto'), 'auto')
    assert.equal(remoteDefaultApproval(undefined), 'auto')
    assert.equal(remoteDefaultApproval('nope'), 'auto')
  })
})

describe('remoteControlAgentRows', () => {
  it('keeps structured enabled agents and uses the display name fallback', () => {
    const rows = remoteControlAgentRows([
      {
        id: 'claude',
        name: 'Claude Code',
        binaryPath: 'claude',
        binaryCandidates: ['claude'],
        defaultArgs: [],
        envVars: {},
        enabled: true,
        providerName: 'anthropic',
        builtin: true
      },
      {
        id: 'pi',
        name: '',
        binaryPath: 'pi',
        binaryCandidates: ['pi'],
        defaultArgs: [],
        envVars: {},
        enabled: true,
        providerName: null,
        builtin: true
      },
      {
        id: 'cursor',
        name: 'Cursor',
        binaryPath: 'cursor-agent',
        binaryCandidates: ['cursor-agent'],
        defaultArgs: [],
        envVars: {},
        enabled: false,
        providerName: null,
        builtin: true
      }
    ])
    assert.deepEqual(
      rows.map((row) => row.id),
      ['claude', 'pi']
    )
    assert.equal(rows[0]?.label, 'Claude Code')
    assert.equal(rows[1]?.label, 'Pi')
  })
})

describe('remoteCatalogModelRows', () => {
  it('uses the live snapshot then filters disabled ids', () => {
    const rows = remoteCatalogModelRows({
      host: 'claude',
      apiEndpoint: 'https://api.deepseek.com',
      customModels: [],
      defaultModel: 'x',
      disabledAgentModels: { claude: ['opus'] },
      snapshot: {
        claude: {
          models: [
            { id: 'sonnet', label: 'Sonnet' },
            { id: 'opus', label: 'Opus' }
          ]
        }
      }
    })
    assert.deepEqual(rows, [{ id: 'sonnet', label: 'Sonnet' }])
  })
})
