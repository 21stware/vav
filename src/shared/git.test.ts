import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { emptyGitSnapshot, isGitSnapshot } from './git.ts'

describe('git snapshot helpers', () => {
  it('emptyGitSnapshot is a valid non-repo snapshot', () => {
    const snap = emptyGitSnapshot('/tmp/ws')
    assert.equal(snap.cwd, '/tmp/ws')
    assert.equal(snap.isRepo, false)
    assert.deepEqual(snap.changes, [])
    assert.equal(isGitSnapshot(snap), true)
  })

  it('rejects missing or incomplete status replies', () => {
    assert.equal(isGitSnapshot(undefined), false)
    assert.equal(isGitSnapshot(null), false)
    assert.equal(isGitSnapshot({ isRepo: true }), false)
    assert.equal(isGitSnapshot({ changes: [] }), false)
  })
})
