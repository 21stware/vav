import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TerminalTab } from '../../../shared/types.ts'
import {
  AGENT_TAB_ID,
  bashThenAgentTabs,
  emptyPtyLayouts,
  isLiveAgentSession,
  isVavMirrorTab,
  mergePtyStatusPreservingExited,
  normalizePtyListResult,
  omitRecord,
  projectPtySessions,
  tabsEqual,
  toolsTrayAfterScrubbingAgentTabs,
  userBashTabsOnly,
  withTombstones
} from './workspacePty.ts'

function tab(id: string, extra: Partial<TerminalTab> = {}): TerminalTab {
  return { id, title: id, isAgent: false, ...extra }
}

describe('workspacePty', () => {
  it('normalizes a legacy session array into layouts', () => {
    const sessions = [{ id: 't1', title: 'bash' }]
    const listed = normalizePtyListResult(sessions as never)
    assert.deepEqual(listed.layouts, emptyPtyLayouts())
    assert.equal(listed.sessions, sessions)
  })

  it('compares tabs and puts the VAV mirror after user bash', () => {
    const agent = tab(AGENT_TAB_ID, { isAgent: true, agentId: 'vav' })
    const bash = tab('sh')
    assert.equal(tabsEqual([bash, agent], [bash, agent]), true)
    assert.equal(tabsEqual([bash], [agent]), false)
    assert.equal(isVavMirrorTab(agent), true)
    assert.deepEqual(
      bashThenAgentTabs([agent, bash]).map((t) => t.id),
      ['sh', AGENT_TAB_ID]
    )
    assert.deepEqual(
      userBashTabsOnly([bash, tab('cli', { agentId: 'claude' })]).map((t) => t.id),
      ['sh']
    )
  })

  it('keeps exited panes as tombstones and omits a record key', () => {
    const previous = [tab('a'), tab('b')]
    const projected = [tab('a')]
    const merged = withTombstones(projected, previous, { b: 'exited' })
    assert.deepEqual(
      merged.map((t) => t.id),
      ['a', 'b']
    )
    assert.equal(isLiveAgentSession({ tabs: [], layout: null, activeTabId: '' }, 'claude'), false)
    assert.deepEqual(omitRecord({ a: 1, b: 2 }, 'a'), { b: 2 })
  })

  it('projects bash, VAV mirror, and CLI agent hosts from PTY snapshots', () => {
    const projected = projectPtySessions([
      {
        id: 'sh',
        conversationId: 'c1',
        agentId: null,
        title: 'bash',
        createdAt: 1,
        status: 'idle'
      },
      {
        id: AGENT_TAB_ID,
        conversationId: 'c1',
        agentId: 'vav',
        title: 'mirror',
        createdAt: 2,
        status: 'idle'
      },
      {
        id: 'claude-1',
        conversationId: 'c1',
        agentId: 'claude',
        title: 'Claude',
        createdAt: 3,
        status: 'running'
      }
    ])
    assert.deepEqual(
      projected.tabs.map((t) => t.id),
      ['sh', AGENT_TAB_ID]
    )
    assert.equal(projected.tabs[1]?.agentId, 'vav')
    assert.equal(projected.agentHostSessions.claude?.tabs[0]?.id, 'claude-1')
    assert.equal(projected.activeTabId, 'sh')
  })

  it('keeps exited tombstones that are no longer in the live list', () => {
    const { next, unchanged } = mergePtyStatusPreservingExited(
      { live: 'running', dead: 'exited' },
      [{ id: 'live', status: 'running' }]
    )
    assert.deepEqual(next, { live: 'running', dead: 'exited' })
    assert.equal(unchanged, true)
    const changed = mergePtyStatusPreservingExited({}, [{ id: 'n', status: 'running' }])
    assert.equal(changed.unchanged, false)
    assert.deepEqual(changed.next, { n: 'running' })
  })

  it('scrubs leaked CLI tabs from the tools tray and repairs the layout', () => {
    const bash = tab('sh')
    const leaked = tab('claude-1', { agentId: 'claude' })
    const next = toolsTrayAfterScrubbingAgentTabs({
      tabs: [bash, leaked],
      layout: { type: 'leaf', tabId: leaked.id, weight: 1 },
      activeTabId: leaked.id
    })
    assert.deepEqual(
      next.tabs.map((t) => t.id),
      ['sh']
    )
    assert.deepEqual(next.layout, { type: 'leaf', tabId: 'sh', weight: 1 })
    assert.equal(next.activeTabId, 'sh')
  })
})
