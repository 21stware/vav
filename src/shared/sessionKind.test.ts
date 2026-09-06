import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isWorkspaceSession, sessionKindOf } from './sessionKind.ts'

describe('sessionKindOf', () => {
  it('prefers an explicit kind', () => {
    assert.equal(sessionKindOf({ sessionKind: 'timer', fileId: 'x' }), 'timer')
    assert.equal(sessionKindOf({ sessionKind: 'file' }), 'file')
    assert.equal(sessionKindOf({ sessionKind: 'workspace' }), 'workspace')
  })

  it('treats fileId as a file session when kind is missing', () => {
    assert.equal(sessionKindOf({ fileId: 'ino-1' }), 'file')
    assert.equal(sessionKindOf({}), 'workspace')
  })
})

describe('isWorkspaceSession', () => {
  it('excludes file and timer rows', () => {
    assert.equal(isWorkspaceSession({}), true)
    assert.equal(isWorkspaceSession({ fileId: 'a' }), false)
    assert.equal(isWorkspaceSession({ sessionKind: 'timer' }), false)
    assert.equal(isWorkspaceSession({ sessionKind: 'workspace', fileId: null }), true)
  })
})
