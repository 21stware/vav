import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { toFileSessionsState } from './fileSessionsState.ts'

describe('toFileSessionsState', () => {
  it('packs file id, active session, and the session list', () => {
    const sessions = [{ id: 's1', title: 'One', createdAt: 1, updatedAt: 2 }]
    assert.deepEqual(toFileSessionsState('file-a', 's1', sessions), {
      fileId: 'file-a',
      activeSessionId: 's1',
      sessions
    })
  })
})
