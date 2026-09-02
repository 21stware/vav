import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nextFavoriteIds, nextPinnedWorkspaceDirs, archivedListModePatch } from './sessionPins.ts'

describe('nextFavoriteIds', () => {
  it('prepends, drops, and no-ops', () => {
    assert.deepEqual(nextFavoriteIds(['b'], 'a', true), ['a', 'b'])
    assert.deepEqual(nextFavoriteIds(['a', 'b'], 'a', false), ['b'])
    assert.equal(nextFavoriteIds(['a'], 'a', true), null)
    assert.equal(nextFavoriteIds(['a'], 'b', false), null)
  })
})

describe('nextPinnedWorkspaceDirs', () => {
  it('pins a real folder and skips synthetic groups', () => {
    assert.deepEqual(nextPinnedWorkspaceDirs(['/keep'], '/proj', true), ['/proj', '/keep'])
    assert.deepEqual(nextPinnedWorkspaceDirs(['/proj', '/keep'], '/proj', false), ['/keep'])
    assert.equal(nextPinnedWorkspaceDirs(['/proj'], '/proj', true), null)
    assert.equal(nextPinnedWorkspaceDirs(['/keep'], '__tmp', true), null)
    assert.equal(nextPinnedWorkspaceDirs(['/keep'], '  ', true), null)
  })
})

describe('archivedListModePatch', () => {
  it('returns to main only when unarchiving the active archive row', () => {
    assert.deepEqual(archivedListModePatch('a', 'archive', 'a', false), { sidebarListMode: 'main' })
    assert.deepEqual(archivedListModePatch('a', 'archive', 'a', true), {})
    assert.deepEqual(archivedListModePatch('a', 'main', 'a', false), {})
    assert.deepEqual(archivedListModePatch('b', 'archive', 'a', false), {})
  })
})
