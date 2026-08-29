import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildRemoteControls, parseAgentId, parseApprovalMode } from './remoteSessionControls.ts'

describe('buildRemoteControls', () => {
  it('locks the agent after the first turn and hides thinking for Claude', () => {
    const snap = buildRemoteControls({
      conversationId: 'c1',
      cliHost: 'claude',
      model: 'sonnet',
      approvalMode: 'auto',
      hasMessages: true,
      agents: [{ id: 'claude', label: 'Claude Code' }],
      models: [{ id: 'sonnet', label: 'Sonnet' }]
    })
    assert.equal(snap.agent, 'claude')
    assert.equal(snap.agentLocked, true)
    assert.equal(snap.thinking, null)
    assert.deepEqual(snap.approvals.map((row) => row.id), ['auto', 'bypass', 'edit'])
  })

  it('exposes thinking levels for a VAV reasoning model', () => {
    const snap = buildRemoteControls({
      conversationId: 'c1',
      cliHost: null,
      model: 'claude-opus-4-6',
      thinkingLevel: 'low',
      hasMessages: false,
      agents: [],
      models: [{ id: 'claude-opus-4-6', label: 'Opus' }]
    })
    assert.equal(snap.agent, 'vav')
    assert.equal(snap.thinking, 'low')
    assert.ok(snap.thinkingLevels.some((row) => row.id === 'high'))
  })
})

describe('parse helpers', () => {
  it('accepts known agents and approval modes', () => {
    assert.equal(parseAgentId('vav'), 'vav')
    assert.equal(parseAgentId('cursor'), 'cursor')
    assert.equal(parseAgentId('nope'), null)
    assert.equal(parseApprovalMode('bypass'), 'bypass')
    assert.equal(parseApprovalMode('yolo'), null)
  })
})
