import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TerminalLayoutNode } from '../../../shared/types.ts'
import {
  collectLeaves,
  layoutDirectionKey,
  layoutFromTabIds,
  layoutHasColumn,
  layoutPrimaryAxis,
  pickCliLayoutBase,
  reconcileLayout,
  removeLeaf,
  scoreLayoutLeaves,
  shouldRestoreCliLayoutAfterSync,
  splitLeaf
} from './workspaceLayout.ts'

function leaf(tabId: string, weight = 1): TerminalLayoutNode {
  return { type: 'leaf', tabId, weight }
}

describe('workspaceLayout', () => {
  it('splits a leaf into a weighted branch and collects ids in order', () => {
    const split = splitLeaf(leaf('a'), 'a', 'column', 'b', 0.5)
    assert.equal(split.type, 'branch')
    if (split.type !== 'branch') return
    assert.equal(split.direction, 'column')
    assert.deepEqual(collectLeaves(split), ['a', 'b'])
    assert.equal(layoutHasColumn(split), true)
    assert.equal(layoutPrimaryAxis(split), 'column')
  })

  it('removes a leaf and promotes the sibling', () => {
    const split = splitLeaf(leaf('a'), 'a', 'row', 'b')
    const next = removeLeaf(split, 'b')
    assert.deepEqual(next, { type: 'leaf', tabId: 'a', weight: 1 })
  })

  it('builds a row tree from tab ids and keeps column topology on hydrate', () => {
    const built = layoutFromTabIds(['a', 'b', 'c'])
    assert.equal(layoutHasColumn(built), false)
    assert.deepEqual(collectLeaves(built).sort(), ['a', 'b', 'c'])

    const column: TerminalLayoutNode = {
      type: 'branch',
      direction: 'column',
      weight: 1,
      children: [leaf('a'), leaf('b')]
    }
    const hydrated = reconcileLayout(column, ['a', 'b', 'c'])
    assert.equal(layoutHasColumn(hydrated), true)
    assert.deepEqual(collectLeaves(hydrated), ['a', 'b', 'c'])
    assert.match(layoutDirectionKey(hydrated), /^B:column/)
  })

  it('prefers a local column tree over a lagging all-row remote', () => {
    const local: TerminalLayoutNode = {
      type: 'branch',
      direction: 'column',
      weight: 1,
      children: [leaf('a'), leaf('b')]
    }
    const remote = layoutFromTabIds(['a', 'b'])
    const picked = pickCliLayoutBase(local, remote, ['a', 'b'])
    assert.equal(picked, local)
    assert.equal(scoreLayoutLeaves(local, ['a', 'b']), 20)
    assert.equal(scoreLayoutLeaves(null, ['a']), -1)
  })

  it('restores a persisted column tree when hydrate flattened it to row', () => {
    const column: TerminalLayoutNode = {
      type: 'branch',
      direction: 'column',
      weight: 1,
      children: [leaf('a'), leaf('b')]
    }
    const row = layoutFromTabIds(['a', 'b'])
    assert.equal(shouldRestoreCliLayoutAfterSync(column, { layout: row, tabs: [{ id: 'a' }, { id: 'b' }] }), true)
    assert.equal(shouldRestoreCliLayoutAfterSync(null, { layout: row, tabs: [{ id: 'a' }] }), false)
  })
})
