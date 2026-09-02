import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TerminalTab } from '../../../shared/types.ts'
import {
  AGENT_TAB_ID,
  bashThenAgentTabs,
  emptyPtyLayouts,
  isLiveAgentSession,
  isVavMirrorTab,
  normalizePtyListResult,
  omitRecord,
  tabsEqual,
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
})
