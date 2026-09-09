import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  emptyGitSnapshot,
  isGitBranchesPage,
  isGitLogPage,
  isGitSnapshot,
  isGitStashesPage,
  suggestWorktreePath
} from './git.ts'

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

  it('accepts log / branch / stash pages', () => {
    assert.equal(isGitLogPage({ commits: [] }), true)
    assert.equal(isGitLogPage({}), false)
    assert.equal(isGitBranchesPage({ local: [], remote: [] }), true)
    assert.equal(isGitBranchesPage({ local: [] }), false)
    assert.equal(isGitStashesPage({ stashes: [] }), true)
    assert.equal(isGitStashesPage({}), false)
  })

  it('suggests a sibling worktree path from the branch name', () => {
    assert.equal(suggestWorktreePath('/Users/me/vav', 'feat/ui'), '/Users/me/vav-feat-ui')
    assert.equal(
      suggestWorktreePath('C:\\src\\vav', 'fix/n'),
      'C:\\src\\vav-fix-n'
    )
  })
})
