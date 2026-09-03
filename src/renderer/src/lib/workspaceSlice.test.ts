import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dirEntriesEqual, emptySlice, normalizeDirListError } from './workspaceSlice.ts'

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
