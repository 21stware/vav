import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TerminalLayoutNode, TerminalTab } from '../../../shared/types.ts'
import { CLI_PENDING_PREFIX } from './cliPendingLayout.ts'
import { collectLeaves } from './workspaceLayout.ts'
import {
  CLI_SURFACE_KEY,
  mergeCliSurface,
  pickCliScreenFocusTab,
  reconcileAgentHosts,
  type AgentHostSession
} from './workspaceCliSurface.ts'

function tab(partial: Partial<TerminalTab> & { id: string }): TerminalTab {
  return {
    title: partial.title ?? 'CLI',
    isAgent: false,
    agentId: partial.agentId ?? null,
    pendingCli: partial.pendingCli ?? false,
    splitWeight: 1,
    ...partial
  }
}

function leaf(tabId: string): TerminalLayoutNode {
  return { type: 'leaf', tabId, weight: 1 }
}

describe('workspaceCliSurface', () => {
  it('maps a pending picker leaf onto a newly spawned PTY without adding a pane', () => {
    const pendingId = `${CLI_PENDING_PREFIX}chooser`
    const prev: AgentHostSession = {
      tabs: [tab({ id: pendingId, pendingCli: true })],
      layout: leaf(pendingId),
      activeTabId: pendingId
    }
    const live = tab({ id: 'pty-1', agentId: 'claude', title: 'claude' })
    const merged = mergeCliSurface(prev, { claude: { tabs: [live], layout: leaf(live.id), activeTabId: live.id } }, null)
    assert.ok(merged)
    assert.deepEqual(
      merged!.tabs.map((t) => t.id),
      ['pty-1']
    )
    assert.deepEqual(collectLeaves(merged!.layout), ['pty-1'])
    assert.equal(merged!.tabs[0]?.pendingCli, false)
    assert.equal(merged!.activeTabId, 'pty-1')
  })

  it('keeps the previous screen when projection is briefly empty', () => {
    const prev: AgentHostSession = {
      tabs: [tab({ id: 'pty-1', agentId: 'claude' })],
      layout: leaf('pty-1'),
      activeTabId: 'pty-1'
    }
    const merged = mergeCliSurface(prev, {}, null)
    assert.equal(merged?.tabs[0]?.id, 'pty-1')
    assert.deepEqual(collectLeaves(merged?.layout ?? null), ['pty-1'])
  })

  it('folds live hosts into the unified CLI surface key', () => {
    const live = tab({ id: 'pty-1', agentId: 'claude' })
    const out = reconcileAgentHosts(
      {},
      { claude: { tabs: [live], layout: leaf(live.id), activeTabId: live.id } }
    )
    assert.equal(Object.keys(out).includes(CLI_SURFACE_KEY), true)
    assert.equal(out[CLI_SURFACE_KEY]?.tabs[0]?.id, 'pty-1')
  })

  it('prefers a live pane of the focused agent, then any live pane', () => {
    const tabs = [
      tab({ id: 'pending', pendingCli: true, agentId: null }),
      tab({ id: 'claude', agentId: 'claude' }),
      tab({ id: 'cursor', agentId: 'cursor' })
    ]
    assert.equal(pickCliScreenFocusTab(tabs, 'cursor')?.id, 'cursor')
    assert.equal(pickCliScreenFocusTab(tabs, 'missing')?.id, 'claude')
    assert.equal(pickCliScreenFocusTab([tabs[0]!], 'cursor')?.id, 'pending')
    assert.equal(pickCliScreenFocusTab([], 'cursor'), undefined)
  })
})
