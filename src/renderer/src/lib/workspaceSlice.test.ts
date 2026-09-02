import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { emptySlice } from './workspaceSlice.ts'

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
