import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pendingChangeSetFileCount } from './changeSet.ts'

describe('pendingChangeSetFileCount', () => {
  it('counts only pending files', () => {
    assert.equal(pendingChangeSetFileCount([]), 0)
    assert.equal(
      pendingChangeSetFileCount([
        { status: 'pending' },
        { status: 'accepted' },
        { status: 'pending' },
        { status: 'rejected' }
      ]),
      2
    )
  })
})
