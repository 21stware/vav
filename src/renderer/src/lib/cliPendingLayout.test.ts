import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TerminalLayoutNode, TerminalTab } from '@shared/types'
import {
  adoptRemotePendingTabs,
  isPendingCliTabId,
  pendingTabsFromLayout,
  replaceLayoutTabId
} from './cliPendingLayout.ts'

const pendingLeaf = (id: string): TerminalLayoutNode => ({
  type: 'leaf',
  tabId: id,
  weight: 1
})

function liveTab(id: string): TerminalTab {
  return {
    id,
    title: 'claude',
    isAgent: false,
    agentId: 'claude',
    pendingCli: false,
    splitWeight: 1
  }
}

describe('cliPendingLayout', () => {
  it('recognizes pending picker ids', () => {
    assert.equal(isPendingCliTabId('cli-pending:abc'), true)
    assert.equal(isPendingCliTabId('agent-host:claude:c1'), false)
  })

  it('rebuilds picker tabs from a pending-only layout', () => {
    const id = 'cli-pending:reseed'
    const tabs = pendingTabsFromLayout(pendingLeaf(id))
    assert.equal(tabs.length, 1)
    assert.equal(tabs[0]?.id, id)
    assert.equal(tabs[0]?.pendingCli, true)
    assert.equal(tabs[0]?.agentId, null)
  })

  it('adopts remote pending when local tabs are dead live panes', () => {
    const remote = pendingLeaf('cli-pending:from-companion')
    const adopted = adoptRemotePendingTabs([liveTab('pty-dead')], remote)
    assert.ok(adopted)
    assert.equal(adopted[0]?.id, 'cli-pending:from-companion')
  })

  it('does not replace a local picker during enterCliMode / list race', () => {
    const local: TerminalTab[] = [
      {
        id: 'cli-pending:local',
        title: 'CLI',
        isAgent: false,
        agentId: null,
        pendingCli: true,
        splitWeight: 1
      }
    ]
    assert.equal(
      adoptRemotePendingTabs(local, pendingLeaf('cli-pending:stale-remote')),
      null
    )
  })

  it('does not invent a picker when remote still names dead live ids', () => {
    assert.equal(adoptRemotePendingTabs([liveTab('pty-dead')], pendingLeaf('pty-dead')), null)
  })

  it('replaces a pending leaf without reshaping the split', () => {
    const tree: TerminalLayoutNode = {
      type: 'branch',
      direction: 'row',
      weight: 1,
      children: [pendingLeaf('cli-pending:a'), pendingLeaf('cli-pending:b')]
    }
    const next = replaceLayoutTabId(tree, 'cli-pending:a', 'agent-host:claude:c1')
    assert.ok(next)
    assert.equal(next.type, 'branch')
    if (next.type !== 'branch') return
    assert.equal(next.children[0].type, 'leaf')
    assert.equal(next.children[0].type === 'leaf' && next.children[0].tabId, 'agent-host:claude:c1')
    assert.equal(next.children[1].type === 'leaf' && next.children[1].tabId, 'cli-pending:b')
  })
})
