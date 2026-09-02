import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LOCAL_MACHINE_ID,
  conversationOnMachine,
  formatWorkspaceLabel,
  isLocalMachine,
  normalizeMachineId,
  workspaceRef
} from './workspaceHost.ts'

describe('normalizeMachineId', () => {
  it('treats empty as local', () => {
    assert.equal(normalizeMachineId(null), LOCAL_MACHINE_ID)
    assert.equal(normalizeMachineId(''), LOCAL_MACHINE_ID)
    assert.equal(normalizeMachineId('  '), LOCAL_MACHINE_ID)
  })

  it('keeps a remote id', () => {
    assert.equal(normalizeMachineId('build-server'), 'build-server')
  })
})

describe('isLocalMachine', () => {
  it('is true for missing and local', () => {
    assert.equal(isLocalMachine(undefined), true)
    assert.equal(isLocalMachine(LOCAL_MACHINE_ID), true)
  })

  it('is false for a paired machine', () => {
    assert.equal(isLocalMachine('build-server'), false)
  })
})

describe('formatWorkspaceLabel', () => {
  it('leaves local paths unprefixed', () => {
    assert.equal(formatWorkspaceLabel(null, '~/repo/vav'), '~/repo/vav')
    assert.equal(formatWorkspaceLabel(LOCAL_MACHINE_ID, '~/repo/vav'), '~/repo/vav')
  })

  it('prefixes a remote machine id', () => {
    assert.equal(formatWorkspaceLabel('build-server', '~/repo/vav'), 'build-server : ~/repo/vav')
  })

  it('prefers the human host name', () => {
    assert.equal(
      formatWorkspaceLabel('abc123', '~/repo/vav', 'Studio Mac'),
      'Studio Mac : ~/repo/vav'
    )
  })
})

describe('workspaceRef', () => {
  it('normalizes a missing machine onto local', () => {
    assert.deepEqual(workspaceRef('/tmp/x'), { machineId: LOCAL_MACHINE_ID, path: '/tmp/x' })
  })
})

describe('conversationOnMachine', () => {
  it('treats a missing machineId as local', () => {
    assert.equal(conversationOnMachine({}, LOCAL_MACHINE_ID), true)
    assert.equal(conversationOnMachine({ machineId: null }, 'box'), false)
  })

  it('matches a paired daemon', () => {
    assert.equal(conversationOnMachine({ machineId: 'box' }, 'box'), true)
    assert.equal(conversationOnMachine({ machineId: 'box' }, LOCAL_MACHINE_ID), false)
  })
})
