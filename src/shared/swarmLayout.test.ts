import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectSwarmLeaves,
  expandRemovedSwarmIds,
  insertSwarmLeaf,
  pruneSwarmLeaves,
  rememberSwarmLayout,
  removeSwarmLeaf,
  restoreSwarmLeaf,
  sanitizeSwarmLayout,
  splitSwarmLeaf,
  swarmLeaf,
  swarmRootId
} from './swarmLayout.ts'

describe('swarmLayout', () => {
  it('splits the focused leaf and keeps insertion order', () => {
    const root = swarmLeaf('a')
    const next = splitSwarmLeaf(root, 'a', 'row', 'b')
    assert.deepEqual(collectSwarmLeaves(next), ['a', 'b'])
  })

  it('inserts a parked session as a horizontal (row) split', () => {
    const layout = splitSwarmLeaf(swarmLeaf('root'), 'root', 'column', 'live')
    const next = insertSwarmLeaf(layout, 'live', 'row', 'parked')
    assert.deepEqual(collectSwarmLeaves(next), ['root', 'live', 'parked'])
  })

  it('does not duplicate an already visible pane', () => {
    const layout = splitSwarmLeaf(swarmLeaf('a'), 'a', 'row', 'b')
    assert.equal(insertSwarmLeaf(layout, 'a', 'row', 'b'), layout)
  })

  it('collapses the branch when a leaf is removed', () => {
    const layout = splitSwarmLeaf(swarmLeaf('a'), 'a', 'row', 'b')
    const next = removeSwarmLeaf(layout, 'b')
    assert.deepEqual(collectSwarmLeaves(next), ['a'])
  })

  it('sanitizes a valid tree and drops junk', () => {
    const ok = sanitizeSwarmLayout({
      type: 'branch',
      direction: 'row',
      weight: 1,
      children: [
        { type: 'leaf', tabId: 'a', weight: 1 },
        { type: 'leaf', tabId: 'b', weight: 1 }
      ]
    })
    assert.deepEqual(collectSwarmLeaves(ok), ['a', 'b'])
    assert.equal(sanitizeSwarmLayout({ type: 'nope' }), null)
  })

  it('treats a missing parent as the session root', () => {
    assert.equal(swarmRootId('c1', null), 'c1')
    assert.equal(swarmRootId('c2', 'c1'), 'c1')
  })

  it('prunes parked leaves and restores a closed pane in its old slot', () => {
    const full = splitSwarmLeaf(splitSwarmLeaf(swarmLeaf('a'), 'a', 'row', 'b'), 'b', 'column', 'c')
    const visible = pruneSwarmLeaves(full, new Set(['a', 'c']))
    assert.deepEqual(collectSwarmLeaves(visible), ['a', 'c'])
    const restored = restoreSwarmLeaf(visible!, full, 'b', 'a')
    assert.deepEqual(collectSwarmLeaves(restored), ['a', 'b', 'c'])
  })

  it('keeps parked leaves when remembering a later split', () => {
    const parked = splitSwarmLeaf(swarmLeaf('a'), 'a', 'row', 'b')
    const live = splitSwarmLeaf(swarmLeaf('a'), 'a', 'row', 'd')
    const next = rememberSwarmLayout(parked, live)
    assert.ok(collectSwarmLeaves(next).includes('b'))
    assert.ok(collectSwarmLeaves(next).includes('d'))
  })

  it('falls back to a row split when the session was never in the tree', () => {
    const visible = splitSwarmLeaf(swarmLeaf('a'), 'a', 'column', 'c')
    const next = restoreSwarmLeaf(visible, visible, 'x', 'c')
    assert.deepEqual(collectSwarmLeaves(next), ['a', 'c', 'x'])
  })

  it('expands a parent delete to its children', () => {
    const rows = [
      { id: 'p' },
      { id: 'a', swarmParentId: 'p' },
      { id: 'b', swarmParentId: 'p' },
      { id: 'x' }
    ]
    assert.deepEqual(expandRemovedSwarmIds(rows, ['p']).sort(), ['a', 'b', 'p'])
  })
})
