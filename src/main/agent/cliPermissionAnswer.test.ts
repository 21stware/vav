import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  cliPermissionAllow,
  cliPermissionOutput,
  cliPermissionStatus,
  findPendingPermission,
  patchedPermissionToolBlock
} from './cliPermissionAnswer.ts'

const labels = {
  accepted: 'Accepted',
  rejected: 'Rejected',
  approved: 'Approved',
  denied: 'Denied'
}

describe('cliPermissionAllow', () => {
  it('treats ask/form cancel as deny and Approve as allow', () => {
    assert.equal(cliPermissionAllow('ask', 'Keep writing'), true)
    assert.equal(cliPermissionAllow('ask', 'Cancel'), false)
    assert.equal(cliPermissionAllow('form', 'Cancel'), false)
    assert.equal(cliPermissionAllow('plan_doc', 'Approve'), true)
    assert.equal(cliPermissionAllow('permission', 'Approve'), true)
    assert.equal(cliPermissionAllow('permission', 'Deny'), false)
    assert.equal(cliPermissionAllow('url', 'Deny'), false)
  })
})

describe('cliPermissionStatus / output', () => {
  it('parks permission as executing and ask as the answer text', () => {
    assert.equal(cliPermissionStatus('permission', true), 'executing')
    assert.equal(cliPermissionStatus('ask', true), 'completed')
    assert.equal(cliPermissionStatus('ask', false), 'skipped')
    assert.equal(cliPermissionOutput('ask', true, 'Keep writing', labels), 'Keep writing')
    assert.equal(cliPermissionOutput('plan_doc', true, 'x', labels), 'Accepted')
    assert.equal(cliPermissionOutput('plan_doc', false, 'x', labels), 'Rejected')
    assert.equal(cliPermissionOutput('permission', true, 'x', labels), 'Approved')
    assert.equal(cliPermissionOutput('url', false, 'x', labels), 'Denied')
  })

  it('stamps status/output onto the card and clears choices', () => {
    const block = {
      kind: 'toolCall' as const,
      id: 't1',
      tool: 'permission',
      summary: 'Allow?',
      input: '{}',
      output: '',
      status: 'pending' as const,
      choices: ['Approve', 'Deny']
    }
    const next = patchedPermissionToolBlock(block, 'permission', true, 'Approve', labels)
    assert.equal(next.status, 'executing')
    assert.equal(next.output, 'Approved')
    assert.equal(next.choices, undefined)
    assert.equal(next.id, 't1')
    assert.equal(block.choices?.length, 2)
  })
})

describe('findPendingPermission', () => {
  it('prefers the map key then a payload whose toolCallId matches', () => {
    const pending = new Map([
      ['k1', { toolCallId: 'other' }],
      ['k2', { toolCallId: 'want' }]
    ])
    assert.equal(findPendingPermission(pending, 'k1')?.toolCallId, 'other')
    assert.equal(findPendingPermission(pending, 'want')?.toolCallId, 'want')
    assert.equal(findPendingPermission(pending, 'missing'), undefined)
  })
})
