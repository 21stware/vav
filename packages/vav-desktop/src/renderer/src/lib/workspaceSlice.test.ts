import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  dirEntriesEqual,
  emptySlice,
  nextExpandedPaths,
  normalizeDirListError,
  planDirListingPatch,
  planWorkingDirectorySlice
} from './workspaceSlice.ts'

describe('emptySlice', () => {
  it('starts a rooted workspace expanded at the root', () => {
    const slice = emptySlice('/tmp/proj')
    assert.equal(slice.root, '/tmp/proj')
    assert.deepEqual(slice.expanded, ['/tmp/proj'])
    assert.equal(slice.sort, 'name')
    assert.equal(slice.ascending, true)
    assert.equal(slice.cliMode, false)
    assert.equal(slice.activeHostAgentId, null)
    assert.deepEqual(slice.agentHostSessions, {})
    assert.deepEqual(slice.tabs, [])
    assert.equal(slice.layout, null)
    assert.equal(slice.terminalOutputExpanded, false)
  })

  it('leaves an unbound workspace unexpanded', () => {
    const slice = emptySlice(null)
    assert.equal(slice.root, null)
    assert.deepEqual(slice.expanded, [])
    assert.equal(slice.selectedPath, null)
  })
})

describe('normalizeDirListError', () => {
  it('collapses missing-path noise to ENOENT and leaves other errors', () => {
    assert.equal(normalizeDirListError(undefined), undefined)
    assert.equal(normalizeDirListError('ENOENT: no such file or directory'), 'ENOENT')
    assert.equal(normalizeDirListError('EACCES: permission denied'), 'EACCES: permission denied')
  })
})

describe('dirEntriesEqual', () => {
  it('compares listing identity fields and rejects a missing previous list', () => {
    const a = { path: '/a', name: 'a', isDirectory: false, size: 1, modifiedAt: 2 }
    assert.equal(dirEntriesEqual([a], [a]), true)
    assert.equal(dirEntriesEqual(undefined, [a]), false)
    assert.equal(dirEntriesEqual([a], [{ ...a, size: 9 }]), false)
  })
})

describe('planDirListingPatch', () => {
  it('returns loading-only when the listing is unchanged, else writes dirs', () => {
    const a = { path: '/a', name: 'a', isDirectory: false, size: 1, modifiedAt: 2 }
    const same = planDirListingPatch(
      { dirs: { '/': [a] }, dirErrors: {}, dirTruncated: { '/': 0 }, loadingDirs: ['/'] },
      '/',
      [a],
      { truncated: 0 },
      undefined
    )
    assert.deepEqual(same, { loadingDirs: [] })
    const next = planDirListingPatch(
      { dirs: {}, dirErrors: {}, dirTruncated: {}, loadingDirs: ['/'] },
      '/',
      [a],
      { truncated: 0 },
      undefined
    )
    assert.deepEqual(next.dirs?.['/'], [a])
    assert.deepEqual(next.loadingDirs, [])
  })
})

describe('planWorkingDirectorySlice', () => {
  it('wipes the file tree and keeps bash plus CLI host layouts', () => {
    const prev = emptySlice('/old')
    prev.sort = 'dateModified'
    prev.ascending = false
    prev.dirs = { '/old': [] }
    prev.expanded = ['/old', '/old/src']
    prev.selectedPath = '/old/a.ts'
    prev.tabs = [{ id: 'bash-1', title: 'bash', isAgent: false, agentId: null, splitWeight: 1 }]
    prev.activeTabId = 'bash-1'
    prev.layout = { type: 'leaf', tabId: 'bash-1', weight: 1 }
    prev.cliMode = true
    prev.activeHostAgentId = '__cli__'
    prev.agentHostSessions = {
      __cli__: { tabs: [], layout: null, activeTabId: '' }
    }
    const next = planWorkingDirectorySlice(prev, '/new')
    assert.equal(next.root, '/new')
    assert.deepEqual(next.dirs, {})
    assert.deepEqual(next.expanded, ['/new'])
    assert.equal(next.selectedPath, null)
    assert.equal(next.sort, 'dateModified')
    assert.equal(next.ascending, false)
    assert.equal(next.tabs, prev.tabs)
    assert.equal(next.activeTabId, 'bash-1')
    assert.equal(next.layout, prev.layout)
    assert.equal(next.cliMode, true)
    assert.equal(next.activeHostAgentId, '__cli__')
    assert.equal(next.agentHostSessions, prev.agentHostSessions)
  })
})

describe('nextExpandedPaths', () => {
  it('toggles with the pre-click expanded flag, not a re-read of includes', () => {
    assert.deepEqual(nextExpandedPaths(['/a', '/b'], '/b', true), ['/a'])
    assert.deepEqual(nextExpandedPaths(['/a'], '/b', false), ['/a', '/b'])
  })
})
