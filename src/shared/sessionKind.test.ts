import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAppObjectSession,
  isDbSession,
  isKnowledgeSession,
  isListSession,
  isTimerDefinition,
  isWorkspaceSession,
  sessionKindOf
} from './sessionKind.ts'

describe('sessionKindOf', () => {
  it('prefers an explicit kind', () => {
    assert.equal(sessionKindOf({ sessionKind: 'timer', fileId: 'x' }), 'timer')
    assert.equal(sessionKindOf({ sessionKind: 'file' }), 'file')
    assert.equal(sessionKindOf({ sessionKind: 'workspace' }), 'workspace')
    assert.equal(sessionKindOf({ sessionKind: 'db' }), 'db')
    assert.equal(sessionKindOf({ sessionKind: 'knowledge' }), 'knowledge')
  })

  it('treats fileId as a file session when kind is missing', () => {
    assert.equal(sessionKindOf({ fileId: 'ino-1' }), 'file')
    assert.equal(sessionKindOf({}), 'workspace')
  })
})

describe('isTimerDefinition', () => {
  it('is a timer chat without a run id', () => {
    assert.equal(isTimerDefinition({ sessionKind: 'timer' }), true)
    assert.equal(isTimerDefinition({ sessionKind: 'timer', timerRunId: 'r1' }), false)
    assert.equal(isTimerDefinition({ sessionKind: 'workspace' }), false)
  })
})

describe('isWorkspaceSession', () => {
  it('excludes file and timer rows', () => {
    assert.equal(isWorkspaceSession({}), true)
    assert.equal(isWorkspaceSession({ fileId: 'a' }), false)
    assert.equal(isWorkspaceSession({ sessionKind: 'timer' }), false)
    assert.equal(isWorkspaceSession({ sessionKind: 'db' }), false)
    assert.equal(isWorkspaceSession({ sessionKind: 'knowledge' }), false)
    assert.equal(isWorkspaceSession({ sessionKind: 'workspace', fileId: null }), true)
    assert.equal(isListSession({}), true)
    assert.equal(isAppObjectSession({ sessionKind: 'db' }), true)
    assert.equal(isAppObjectSession({}), false)
  })
})

describe('isKnowledgeSession', () => {
  it('is only the knowledge category row', () => {
    assert.equal(isKnowledgeSession({ sessionKind: 'knowledge' }), true)
    assert.equal(isKnowledgeSession({ sessionKind: 'db' }), false)
    assert.equal(isKnowledgeSession({}), false)
  })
})

describe('isDbSession', () => {
  it('is only the db category row', () => {
    assert.equal(isDbSession({ sessionKind: 'db' }), true)
    assert.equal(isDbSession({ sessionKind: 'timer' }), false)
    assert.equal(isDbSession({}), false)
  })
})
