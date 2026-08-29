import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  remoteBrowseRoots,
  remoteIsTemporary,
  remoteParentPath,
  remotePathAllowed
} from './remoteWorkspace.ts'

describe('remote workspace confinement', () => {
  it('allows home, tmp, and the current session folder', () => {
    const roots = remoteBrowseRoots({
      home: '/Users/me',
      tmp: '/tmp',
      current: '/Users/me/repo/vav',
      recent: ['/Users/me/repo/other']
    })
    assert.equal(remotePathAllowed('/Users/me/repo/vav', roots), true)
    assert.equal(remotePathAllowed('/Users/me/repo/other/src', roots), true)
    assert.equal(remotePathAllowed('/etc/passwd', roots), false)
    assert.equal(remotePathAllowed('/Users/other', roots), false)
  })

  it('treats tmp-prefixed paths as temporary workspaces', () => {
    assert.equal(remoteIsTemporary('/tmp/vav/abcd/Workspace', '/tmp'), true)
    assert.equal(remoteIsTemporary('/Users/me/repo', '/tmp'), false)
    assert.equal(remoteIsTemporary(null, '/tmp'), true)
  })

  it('walks up only while still inside a root', () => {
    const roots = ['/Users/me']
    assert.equal(remoteParentPath('/Users/me/repo/vav', roots), '/Users/me/repo')
    assert.equal(remoteParentPath('/Users/me', roots), null)
  })
})
