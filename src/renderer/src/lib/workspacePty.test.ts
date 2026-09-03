import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TerminalTab } from '../../../shared/types.ts'
import {
  AGENT_TAB_ID,
  bashThenAgentTabs,
  closeBashTabSlicePatch,
  emptyPtyLayouts,
  ensureVavAgentTabPatch,
  isLiveAgentSession,
  isVavMirrorTab,
  mergePtyStatusPreservingExited,
  normalizePtyListResult,
  omitRecord,
  planAppendUserBashTab,
  planBashSplit,
  planFirstBashPane,
  projectPtySessions,
  ptyCreateOptions,
  ptyTabStatusPatch,
  isCliAgentHostId,
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

  it('seeds a first bash leaf and splits a second pane on the requested axis', () => {
    const first = planFirstBashPane([tab('sh')], 'sh', { title: 'install', purpose: 'install' })
    assert.deepEqual(first.layout, { type: 'leaf', tabId: 'sh', weight: 1 })
    assert.equal(first.tabs[0]?.title, 'install')
    const split = planBashSplit(
      { tabs: [tab('sh')], layout: { type: 'leaf', tabId: 'sh', weight: 1 } },
      { focusId: 'sh', newTabId: 'sh-2', axis: 'column' }
    )
    assert.equal(split.layout.type, 'branch')
    if (split.layout.type === 'branch') assert.equal(split.layout.direction, 'column')
    assert.deepEqual(
      split.tabs.map((t) => t.id),
      ['sh', 'sh-2']
    )
  })

  it('builds agent vs bash pty.create options and appends a bash tab', () => {
    assert.equal(isCliAgentHostId('claude'), true)
    assert.equal(isCliAgentHostId('vav'), false)
    assert.equal(isCliAgentHostId(null), false)
    const agent = ptyCreateOptions({
      preferredId: 'pref',
      agent: { binaryPath: '/bin/claude', id: 'claude', name: 'Claude', defaultArgs: ['--foo'] },
      launchContext: '  notes  ',
      extras: { sessionTitle: 'Resume' }
    })
    assert.equal(agent.command, '/bin/claude')
    assert.equal(agent.preferredId, 'pref')
    assert.equal(agent.launchContext, 'notes')
    assert.equal(agent.title, 'Resume')
    const bash = ptyCreateOptions({ extras: { title: 'install', purpose: 'install' } })
    assert.equal(bash.agentId, null)
    assert.equal(bash.pinTitle, true)
    const appended = planAppendUserBashTab([tab('sh')], 'sh-2', { title: 'job' }, 2)
    assert.deepEqual(
      appended.tabs.map((t) => t.id),
      ['sh', 'sh-2']
    )
    assert.equal(appended.tabs[1]?.title, 'job')
    assert.equal(appended.activeTabId, 'sh-2')
  })

  it('seeds a VAV mirror tab, closes a bash pane, and stamps pty status', () => {
    const seeded = ensureVavAgentTabPatch({ tabs: [tab('sh')], layout: null })
    assert.equal(seeded.activeTabId, AGENT_TAB_ID)
    assert.equal(seeded.tabs.some((t) => t.isAgent && t.agentId === 'vav'), true)
    assert.deepEqual(seeded.layout, { type: 'leaf', tabId: AGENT_TAB_ID, weight: 1 })
    const closed = closeBashTabSlicePatch(
      {
        tabs: [tab('sh'), tab('sh-2')],
        layout: { type: 'leaf', tabId: 'sh', weight: 1 },
        activeTabId: 'sh'
      },
      'sh'
    )
    assert.deepEqual(
      closed.tabs.map((t) => t.id),
      ['sh-2']
    )
    assert.equal(closed.activeTabId, 'sh-2')
    const status = { c1: { sh: 'running' as const } }
    assert.equal(ptyTabStatusPatch(status, 'c1', 'sh', 'running'), null)
    assert.deepEqual(ptyTabStatusPatch(status, 'c1', 'sh', 'exited')?.ptyStatus.c1.sh, 'exited')
  })
})
