import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PENDING_COMPOSER_ID,
  homeWorkspaceCreateOptions,
  isPendingComposerId
} from './pendingComposer.ts'

describe('pendingComposer', () => {
  it('recognizes only the pending composer id', () => {
    assert.equal(isPendingComposerId(PENDING_COMPOSER_ID), true)
    assert.equal(isPendingComposerId(''), false)
    assert.equal(isPendingComposerId(null), false)
    assert.equal(isPendingComposerId('sess-1'), false)
  })

  it('omits create opts until the user picks a workspace', () => {
    assert.deepEqual(homeWorkspaceCreateOptions(null), {})
  })

  it('passes a null workdir for an explicit temp pick', () => {
    assert.deepEqual(homeWorkspaceCreateOptions({ path: null }), {
      workingDirectory: null
    })
  })

  it('passes path and machine when the user picked a folder', () => {
    assert.deepEqual(
      homeWorkspaceCreateOptions({ path: '/proj/vav', machineId: 'local' }),
      {
        workingDirectory: '/proj/vav',
        machineId: 'local'
      }
    )
  })
})
