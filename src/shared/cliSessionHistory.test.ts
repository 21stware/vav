import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { trayItemLabel } from './traySessions.ts'
import {
  buildSwarmHistoryMenuEntries,
  groupSwarmHistoryRows,
  isBlankSwarmSessionTitle,
  liveSwarmHistoryId,
  longEdgeSplitAxis,
  mergeSwarmHistoryRows,
  parseSwarmHistoryId,
  shouldKeepClosedSwarmHistoryRecord,
  swarmHistoryItemLabel,
  swarmSessionDisplayTitle,
  swarmSessionKey,
  type SwarmHistoryRow
} from './cliSessionHistory.ts'

function row(partial: Partial<SwarmHistoryRow> & Pick<SwarmHistoryRow, 'id'>): SwarmHistoryRow {
  return {
    conversationId: 'c1',
    tabId: null,
    agentId: 'grok',
    agentName: 'Grok',
    title: 'New Session',
    dirKey: '/tmp/a',
    dirLabel: '~/a',
    createdAt: 1,
    updatedAt: 1,
    live: false,
    resumable: true,
    cursor: null,
    ...partial
  }
}

describe('cliSessionHistory', () => {
  it('builds tray-identical labels', () => {
    const title = 'Read Swarm Agent Session Titles'
    const label = swarmHistoryItemLabel({ title, agentName: 'Grok' })
    assert.equal(label, 'Read Swarm Agent Session Titles - Grok')
    assert.equal(
      label,
      trayItemLabel({
        conversationId: 'c',
        tabId: 't',
        kind: 'agent',
        sessionTitle: title,
        paneTitle: 'Grok',
        dirKey: '/tmp',
        dirLabel: '~/tmp',
        createdAt: 1
      })
    )
  })

  it('prefers a user name over the host title', () => {
    assert.equal(
      swarmSessionDisplayTitle({ name: 'My pane', title: 'Host title', fallback: 'Untitled' }),
      'My pane'
    )
    assert.equal(
      swarmSessionDisplayTitle({ name: '  ', title: 'Host title', fallback: 'Untitled' }),
      'Host title'
    )
    assert.equal(swarmSessionDisplayTitle({ fallback: 'Untitled' }), 'Untitled')
    assert.equal(
      swarmSessionDisplayTitle({ title: 'Untitled session', fallback: 'Untitled session' }),
      'Untitled session'
    )
  })

  it('drops closed History rows that never had a conversation', () => {
    assert.equal(isBlankSwarmSessionTitle(null), true)
    assert.equal(isBlankSwarmSessionTitle('  '), true)
    assert.equal(isBlankSwarmSessionTitle('Untitled session'), true)
    assert.equal(isBlankSwarmSessionTitle('未命名会话'), true)
    assert.equal(isBlankSwarmSessionTitle('新会话'), true)
    assert.equal(isBlankSwarmSessionTitle('Skip picker last-window close bug'), false)
    assert.equal(shouldKeepClosedSwarmHistoryRecord({ title: null }), false)
    assert.equal(shouldKeepClosedSwarmHistoryRecord({ title: 'Untitled session' }), false)
    assert.equal(shouldKeepClosedSwarmHistoryRecord({ name: 'My pane', title: null }), true)
    assert.equal(
      shouldKeepClosedSwarmHistoryRecord({ title: null, hasConversation: true }),
      true
    )
    assert.equal(shouldKeepClosedSwarmHistoryRecord({ title: 'Fix the tray menu' }), true)
  })

  it('splits along the long edge (row = left/right, column = top/bottom)', () => {
    assert.equal(longEdgeSplitAxis(800, 400), 'row')
    assert.equal(longEdgeSplitAxis(400, 800), 'column')
    assert.equal(longEdgeSplitAxis(500, 500), 'row')
  })

  it('parses session and live ids', () => {
    assert.equal(swarmSessionKey('grok', 'abc'), 'grok:abc')
    assert.deepEqual(parseSwarmHistoryId('grok:abc'), {
      kind: 'session',
      agentId: 'grok',
      sessionId: 'abc'
    })
    assert.deepEqual(parseSwarmHistoryId(liveSwarmHistoryId('conv', 'tab-1')), {
      kind: 'live',
      conversationId: 'conv',
      tabId: 'tab-1'
    })
    assert.equal(parseSwarmHistoryId('nocolon'), null)
  })

  it('dedupes extras against live rows and groups like the tray', () => {
    const live = row({
      id: 'grok:one',
      live: true,
      tabId: 't1',
      createdAt: 2,
      title: 'Live'
    })
    const extraSame = row({ id: 'grok:one', live: false, title: 'Stale' })
    const extraOther = row({
      id: 'grok:two',
      live: false,
      title: 'Closed',
      dirKey: '/tmp/b',
      dirLabel: '~/b',
      updatedAt: 9
    })
    const merged = mergeSwarmHistoryRows([live], [extraSame, extraOther])
    assert.deepEqual(
      merged.map((item) => item.id),
      ['grok:one', 'grok:two']
    )
    assert.equal(merged[0]!.title, 'Live')
    const groups = groupSwarmHistoryRows([
      row({ id: 'grok:old', live: false, dirKey: '/tmp/a', updatedAt: 1 }),
      row({ id: 'grok:live', live: true, dirKey: '/tmp/a', createdAt: 5, tabId: 't' }),
      extraOther
    ])
    assert.deepEqual(
      groups.map((g) => g.dirLabel),
      ['~/a', '~/b']
    )
    assert.deepEqual(
      groups[0]!.items.map((item) => item.id),
      ['grok:live', 'grok:old']
    )
  })

  it('builds a tray-shaped History select without a Manage footer', () => {
    const entries = buildSwarmHistoryMenuEntries({
      header: 'Agent sessions (2)',
      emptyLabel: 'No agent sessions',
      groups: [
        {
          dirLabel: '~/a',
          items: [
            { id: 'grok:live', label: 'Live - Grok' },
            { id: 'grok:old', label: 'Closed - Grok' }
          ]
        }
      ]
    })
    assert.deepEqual(
      entries.map((entry) => entry.kind),
      ['header', 'separator', 'dir', 'item', 'item']
    )
    assert.deepEqual(
      entries.filter((entry) => entry.kind === 'item').map((entry) => entry.id),
      ['grok:live', 'grok:old']
    )
  })

  it('shows an empty row when History has no sessions', () => {
    const entries = buildSwarmHistoryMenuEntries({
      header: 'Agent sessions (0)',
      emptyLabel: 'No agent sessions',
      groups: []
    })
    assert.deepEqual(
      entries.map((entry) => entry.kind),
      ['header', 'separator', 'empty']
    )
  })
})
