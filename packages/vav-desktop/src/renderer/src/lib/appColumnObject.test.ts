import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  conversationForAppMode,
  focusedAppObjectIdForMode,
  rememberVisitedAppMode
} from './appColumnObject.ts'

describe('conversationForAppMode', () => {
  const storage = { id: 'file-1', fileId: 'f1', sessionKind: 'file' }
  const note = { id: 'note-1', sessionKind: 'knowledge' }
  const agent = { id: 'agent-1', sessionKind: 'workspace' }

  it('uses the live focus on the active tab and the remembered id when parked', () => {
    const state = {
      applicationsMode: 'storage' as const,
      focusedAppObjectId: storage.id,
      focusedAppObjectByMode: { knowledge: note.id, storage: 'stale' },
      activeId: agent.id,
      conversations: [storage, note, agent]
    }
    assert.equal(conversationForAppMode(state, 'storage')?.id, 'file-1')
    assert.equal(conversationForAppMode(state, 'knowledge')?.id, 'note-1')
    assert.equal(conversationForAppMode(state, 'data'), undefined)
  })

  it('does not leak the workspace agent onto a parked tab', () => {
    const state = {
      applicationsMode: 'knowledge' as const,
      focusedAppObjectId: note.id,
      focusedAppObjectByMode: {},
      activeId: agent.id,
      conversations: [note, agent]
    }
    assert.equal(focusedAppObjectIdForMode(state, 'knowledge'), note.id)
    assert.equal(conversationForAppMode(state, 'storage'), undefined)
  })
})

describe('rememberVisitedAppMode', () => {
  it('appends a first visit and no-ops repeats', () => {
    assert.deepEqual(rememberVisitedAppMode(['storage'], 'knowledge'), ['storage', 'knowledge'])
    assert.equal(rememberVisitedAppMode(['storage', 'knowledge'], 'storage'), null)
  })
})
