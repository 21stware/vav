import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  cursorCatalogueDefaultThinking,
  remoteCatalogModelRows,
  remoteControlAgentRows,
  remoteDefaultApproval,
  remoteHostRecentDirs,
  remoteHostSwitchAction,
  remoteLiveConversation,
  remoteSendDisposition,
  buildRemoteHostEvent
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

describe('remoteSendDisposition', () => {
  it('errors missing/archived, queues a busy live turn, else sends', () => {
    assert.equal(remoteSendDisposition(undefined, false), 'not-found')
    assert.equal(remoteSendDisposition({ archived: true }, false), 'archived')
    assert.equal(remoteSendDisposition({ archived: false }, true), 'enqueue')
    assert.equal(remoteSendDisposition({}, false), 'send')
  })
})

describe('remoteHostSwitchAction', () => {
  it('no-ops the same host, locks a thread with messages, else switches', () => {
    assert.equal(remoteHostSwitchAction('claude', 'claude', true), 'same')
    assert.equal(remoteHostSwitchAction(null, 'cursor', true), 'locked')
    assert.equal(remoteHostSwitchAction('claude', 'cursor', false), 'switch')
    assert.equal(remoteHostSwitchAction(null, 'claude', false), 'switch')
  })
})

describe('cursorCatalogueDefaultThinking', () => {
  it('reads the Cursor catalogue default only for a Cursor host + matching id', () => {
    const snapshot = {
      cursor: {
        models: [
          { id: 'composer', label: 'Composer', defaultThinkingLevel: 'medium' as const },
          { id: 'grok', label: 'Grok' }
        ]
      }
    }
    assert.equal(cursorCatalogueDefaultThinking(snapshot, 'composer', 'cursor'), 'medium')
    assert.equal(cursorCatalogueDefaultThinking(snapshot, 'grok', 'cursor'), null)
    assert.equal(cursorCatalogueDefaultThinking(snapshot, 'composer', 'claude'), null)
    assert.equal(cursorCatalogueDefaultThinking(snapshot, '', 'cursor'), null)
    assert.equal(cursorCatalogueDefaultThinking({}, 'composer', 'cursor'), null)
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

describe('buildRemoteHostEvent', () => {
  it('packs identity, defaults, and recent dirs', () => {
    const event = buildRemoteHostEvent({
      name: 'Studio',
      home: '/Users/ada',
      tmp: '/tmp',
      platform: 'darwin',
      defaultAgent: 'vav',
      defaultModel: 'kimi',
      thinking: 'low',
      approval: 'auto',
      recentDirs: [{ path: '/repo', label: 'repo' }]
    })
    assert.equal(event.type, 'host')
    assert.equal(event.name, 'Studio')
    assert.equal(event.defaults.agent, 'vav')
    assert.deepEqual(event.recentDirs, [{ path: '/repo', label: 'repo' }])
    assert.ok(event.capabilities)
  })
})
