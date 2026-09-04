import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TerminalTab } from '../../../shared/types.ts'
import {
  bashGroupChips,
  bashGroupLabel,
  closeBashGroupPatch,
  planNewBashTab,
  planSplitBashPane,
  reconcileBashGroups
} from './bashTabGroups.ts'

function tab(id: string, title = id): TerminalTab {
  return { id, title, isAgent: false, agentId: null }
}

describe('bashTabGroups', () => {
  it('⌘T appends a parallel tab without splitting the current group', () => {
    const first = planNewBashTab(
      {
        tabs: [tab('a', 'one')],
        layout: { type: 'leaf', tabId: 'a', weight: 1 },
        activeTabId: 'a',
        bashGroups: {
          order: ['a'],
          layouts: { a: { type: 'leaf', tabId: 'a', weight: 1 } },
          activeGroupId: 'a'
        }
      },
      'b',
      { title: 'two' }
    )
    assert.deepEqual(first.bashGroups.order, ['a', 'b'])
    assert.equal(first.layout.type, 'leaf')
    if (first.layout.type === 'leaf') assert.equal(first.layout.tabId, 'b')
    assert.equal(first.bashGroups.layouts.a?.type, 'leaf')
    assert.equal(bashGroupChips(first.tabs, first.bashGroups, first.layout).length, 2)
  })

  it('⌘D splits inside the active group and joins titles with |', () => {
    const split = planSplitBashPane(
      {
        tabs: [tab('a', 'alpha')],
        layout: { type: 'leaf', tabId: 'a', weight: 1 },
        activeTabId: 'a',
        bashGroups: {
          order: ['a'],
          layouts: { a: { type: 'leaf', tabId: 'a', weight: 1 } },
          activeGroupId: 'a'
        }
      },
      { focusId: 'a', newTabId: 'b', axis: 'row', extras: { title: 'beta' } }
    )
    assert.equal(split.layout.type, 'branch')
    assert.equal(bashGroupLabel(split.tabs, split.layout), 'alpha | beta')
    assert.deepEqual(bashGroupChips(split.tabs, split.bashGroups, split.layout), [
      { groupId: 'a', label: 'alpha | beta', tabIds: ['a', 'b'] }
    ])
  })

  it('closes every pane in a split group', () => {
    const split = planSplitBashPane(
      {
        tabs: [tab('a', 'alpha')],
        layout: { type: 'leaf', tabId: 'a', weight: 1 },
        activeTabId: 'a',
        bashGroups: {
          order: ['a'],
          layouts: { a: { type: 'leaf', tabId: 'a', weight: 1 } },
          activeGroupId: 'a'
        }
      },
      { focusId: 'a', newTabId: 'b', axis: 'row', extras: { title: 'beta' } }
    )
    const other = planNewBashTab(split, 'c', { title: 'gamma' })
    const closed = closeBashGroupPatch(other, 'a')
    assert.deepEqual(
      closed.tabs.map((t) => t.id),
      ['c']
    )
    assert.deepEqual(closed.bashGroups?.order, ['c'])
    assert.equal(closed.activeTabId, 'c')
  })

  it('does not fold a second tab into the active split on hydrate-style reconcile', () => {
    const next = reconcileBashGroups(
      {
        order: ['a'],
        layouts: { a: { type: 'leaf', tabId: 'a', weight: 1 } },
        activeGroupId: 'a'
      },
      ['a', 'b'],
      { type: 'leaf', tabId: 'a', weight: 1 },
      'a'
    )
    assert.deepEqual(next.groups?.order, ['a', 'b'])
    assert.equal(next.layout?.type, 'leaf')
  })
})
