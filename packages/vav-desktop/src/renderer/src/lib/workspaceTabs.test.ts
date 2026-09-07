import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cliLiveTab, replaceSurfaceTab } from './workspaceTabs.ts'

describe('cliLiveTab', () => {
  it('builds a live CLI pane that is not a picker', () => {
    assert.deepEqual(cliLiveTab('t1', 'claude', 'Claude'), {
      id: 't1',
      title: 'Claude',
      isAgent: false,
      agentId: 'claude',
      pendingCli: false,
      splitWeight: 1
    })
  })
})

describe('replaceSurfaceTab', () => {
  it('swaps the pending leaf and retargets layout + active tab', () => {
    const live = cliLiveTab('pty-1', 'claude', 'Claude')
    const next = replaceSurfaceTab(
      {
        tabs: [
          {
            id: 'cli-pending:1',
            title: 'CLI',
            isAgent: false,
            agentId: null,
            pendingCli: true,
            splitWeight: 1
          }
        ],
        layout: { type: 'leaf', tabId: 'cli-pending:1', weight: 1 },
        activeTabId: 'cli-pending:1'
      },
      'cli-pending:1',
      live
    )
    assert.deepEqual(
      next.tabs.map((tab) => tab.id),
      ['pty-1']
    )
    assert.deepEqual(next.layout, { type: 'leaf', tabId: 'pty-1', weight: 1 })
    assert.equal(next.activeTabId, 'pty-1')
  })
})
