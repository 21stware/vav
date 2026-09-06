import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isMainSidebarSession, sessionKindOf } from './sessionKind.ts'

describe('sessionKindOf', () => {
  it('treats fileId as file even if timerJobId is also set', () => {
    assert.equal(sessionKindOf({ fileId: 'f1', timerJobId: 't1' }), 'file')
  })

  it('treats timerJobId as timer', () => {
    assert.equal(sessionKindOf({ timerJobId: 'job-1' }), 'timer')
  })

  it('defaults to chat', () => {
    assert.equal(sessionKindOf({}), 'chat')
    assert.equal(sessionKindOf({ fileId: null, timerJobId: null }), 'chat')
  })
})

describe('isMainSidebarSession', () => {
  it('hides file and timer sessions from the main list', () => {
    assert.equal(isMainSidebarSession({}), true)
    assert.equal(isMainSidebarSession({ fileId: 'f' }), false)
    assert.equal(isMainSidebarSession({ timerJobId: 'j' }), false)
  })
})
