import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PENDING_COMPOSER_ID,
  homeWorkspaceCreateOptions,
  isPendingComposerId,
  resolveComposerId,
  resolvePendingWorkspace
} from './pendingComposer.ts'

describe('pendingComposer', () => {
  it('treats the empty session shell as the pending composer', () => {
    assert.equal(isPendingComposerId(PENDING_COMPOSER_ID), true)
    assert.equal(isPendingComposerId(''), true)
    assert.equal(isPendingComposerId(null), true)
    assert.equal(isPendingComposerId('   '), true)
    assert.equal(isPendingComposerId('sess-1'), false)
  })

  it('resolves empty ids to the pending composer key', () => {
    assert.equal(resolveComposerId(''), PENDING_COMPOSER_ID)
    assert.equal(resolveComposerId(null), PENDING_COMPOSER_ID)
    assert.equal(resolveComposerId(PENDING_COMPOSER_ID), PENDING_COMPOSER_ID)
    assert.equal(resolveComposerId('sess-1'), 'sess-1')
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

  it('falls back to the default workdir until the user picks', () => {
    assert.deepEqual(resolvePendingWorkspace(null, '/Users/me/proj'), {
      path: '/Users/me/proj'
    })
    assert.deepEqual(resolvePendingWorkspace(null, '  '), { path: null })
    assert.deepEqual(resolvePendingWorkspace({ path: null }, '/Users/me/proj'), {
      path: null
    })
    assert.deepEqual(
      resolvePendingWorkspace({ path: '/tmp/ws', machineId: 'host-1' }, '/Users/me/proj'),
      { path: '/tmp/ws', machineId: 'host-1' }
    )
  })
})
