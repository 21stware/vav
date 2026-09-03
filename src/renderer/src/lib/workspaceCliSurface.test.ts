import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TerminalLayoutNode, TerminalTab } from '../../../shared/types.ts'
import { CLI_PENDING_PREFIX } from './cliPendingLayout.ts'
import { collectLeaves } from './workspaceLayout.ts'
import {
  CLI_SURFACE_KEY,
  mergeCliSurface,
  pickCliScreenFocusTab,
  planEnterCliMode,
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

  it('plans enter-cli: noop, restore, promote, fold, and fresh picker', () => {
    const live = tab({ id: 'pty-1', agentId: 'claude' })
    const surface: AgentHostSession = {
      tabs: [live],
      layout: leaf('pty-1'),
      activeTabId: 'pty-1'
    }
    assert.equal(
      planEnterCliMode({
        cliMode: true,
        agentHostSessions: { [CLI_SURFACE_KEY]: surface }
      }).kind,
      'noop'
    )

    const restored = planEnterCliMode({
      cliMode: false,
      agentHostSessions: { [CLI_SURFACE_KEY]: { ...surface, layout: null } }
    })
    assert.equal(restored.kind, 'patch')
    if (restored.kind === 'patch') {
      assert.deepEqual(collectLeaves(restored.surface.layout), ['pty-1'])
      assert.equal(restored.autoAssignPendingId, undefined)
    }

    const promoted = planEnterCliMode({
      cliMode: false,
      agentHostSessions: {
        claude: { tabs: [live], layout: leaf('pty-1'), activeTabId: 'pty-1' }
      }
    })
    assert.equal(promoted.kind, 'patch')
    if (promoted.kind === 'patch') {
      assert.equal(promoted.surface.tabs[0]?.agentId, 'claude')
      assert.equal(promoted.surface.tabs[0]?.pendingCli, false)
    }

    const cursor = tab({ id: 'pty-2', agentId: 'cursor' })
    const folded = planEnterCliMode({
      cliMode: false,
      agentHostSessions: {
        claude: { tabs: [live], layout: leaf('pty-1'), activeTabId: 'pty-1' },
        cursor: { tabs: [cursor], layout: leaf('pty-2'), activeTabId: 'pty-2' }
      }
    })
    assert.equal(folded.kind, 'patch')
    if (folded.kind === 'patch') {
      assert.deepEqual(
        folded.surface.tabs.map((t) => t.id),
        ['pty-1', 'pty-2']
      )
      assert.deepEqual(collectLeaves(folded.surface.layout), ['pty-1', 'pty-2'])
    }

    const fresh = planEnterCliMode(
      { cliMode: false, agentHostSessions: {} },
      { makePendingTab: () => tab({ id: 'cli-pending:test', pendingCli: true, agentId: null }) }
    )
    assert.equal(fresh.kind, 'patch')
    if (fresh.kind === 'patch') {
      assert.equal(fresh.autoAssignPendingId, 'cli-pending:test')
      assert.equal(fresh.surface.activeTabId, 'cli-pending:test')
    }
  })
})
