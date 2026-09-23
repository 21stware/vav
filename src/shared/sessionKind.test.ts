import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAppObjectSession,
  isDbSession,
  isKnowledgeSession,
  isListSession,
  isTimerDefinition,
  isTimerRun,
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

describe('isTimerRun', () => {
  it('is a timer conversation that already fired', () => {
    assert.equal(isTimerRun({ sessionKind: 'timer', timerRunId: 'r1' }), true)
    assert.equal(isTimerRun({ sessionKind: 'timer' }), false)
    assert.equal(isTimerRun({ sessionKind: 'workspace', timerRunId: 'r1' }), false)
  })
})

describe('isWorkspaceSession', () => {
  it('excludes file and timer definitions, but keeps fired runs in the list', () => {
    assert.equal(isWorkspaceSession({}), true)
    assert.equal(isWorkspaceSession({ fileId: 'a' }), false)
    assert.equal(isWorkspaceSession({ sessionKind: 'timer' }), false)
    assert.equal(isWorkspaceSession({ sessionKind: 'timer', timerRunId: 'r1' }), true)
    assert.equal(isWorkspaceSession({ sessionKind: 'db' }), false)
    assert.equal(isWorkspaceSession({ sessionKind: 'knowledge' }), false)
    assert.equal(isWorkspaceSession({ sessionKind: 'workspace', fileId: null }), true)
    assert.equal(isListSession({}), true)
    assert.equal(isListSession({ sessionKind: 'timer', timerRunId: 'r1' }), true)
    assert.equal(isAppObjectSession({ sessionKind: 'db' }), true)
    assert.equal(isAppObjectSession({ fileId: 'a' }), true)
    assert.equal(isAppObjectSession({ sessionKind: 'file' }), true)
    assert.equal(isAppObjectSession({ sessionKind: 'timer' }), true)
    assert.equal(isAppObjectSession({ sessionKind: 'timer', timerRunId: 'r1' }), false)
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
