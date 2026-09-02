import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { remoteDefaultApproval, remoteHostRecentDirs, remoteLiveConversation } from './sessionGate.ts'

describe('remoteLiveConversation', () => {
  it('gates missing and archived sessions', () => {
    assert.equal(remoteLiveConversation(null), 'not-found')
    assert.equal(remoteLiveConversation({ archived: true }), 'archived')
    assert.equal(remoteLiveConversation({ archived: false }), 'ok')
  })
})

describe('remoteHostRecentDirs', () => {
  it('dedupes pinned+recent, skips missing, and respects the cap', () => {
    const dirs = remoteHostRecentDirs(['/pin', '/shared', '/gone'], ['/shared', '/recent', '/also'], {
      exists: (path) => path !== '/gone',
      label: (path) => path.slice(1),
      cap: 3
    })
    assert.deepEqual(dirs, [
      { path: '/pin', label: 'pin' },
      { path: '/shared', label: 'shared' },
      { path: '/recent', label: 'recent' }
    ])
  })
})

describe('remoteDefaultApproval', () => {
  it('keeps bypass/edit and maps everything else to auto', () => {
    assert.equal(remoteDefaultApproval('bypass'), 'bypass')
    assert.equal(remoteDefaultApproval('edit'), 'edit')
    assert.equal(remoteDefaultApproval('auto'), 'auto')
    assert.equal(remoteDefaultApproval(undefined), 'auto')
    assert.equal(remoteDefaultApproval('nope'), 'auto')
  })
})
