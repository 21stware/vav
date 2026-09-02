import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { trayDirLabel, trayAgentLabel, pickAgentSessionTitle } from './trayLabels.ts'

describe('trayDirLabel', () => {
  it('collapses the home directory and prefixes paths under it', () => {
    assert.equal(trayDirLabel(null, '/Users/ada'), '~')
    assert.equal(trayDirLabel('~', '/Users/ada'), '~')
    assert.equal(trayDirLabel('/Users/ada', '/Users/ada'), '~')
    assert.equal(trayDirLabel('/Users/ada/src/vav', '/Users/ada'), '~/src/vav')
    assert.equal(trayDirLabel('C:\\Users\\ada\\src', 'C:\\Users\\ada'), '~/src')
  })

  it('falls back to the last segment outside home', () => {
    assert.equal(trayDirLabel('/opt/work/long-project-name', '/Users/ada'), 'long-project-name')
  })
})

describe('trayAgentLabel', () => {
  it('uses the settings display name when present', () => {
    assert.equal(trayAgentLabel('claude', [{ id: 'claude', name: 'Claude' }]), 'Claude')
    assert.equal(trayAgentLabel('claude', [{ id: 'codex', name: 'Codex' }]), 'claude')
    assert.equal(trayAgentLabel('claude', undefined), 'claude')
  })
})

describe('pickAgentSessionTitle', () => {
  it('prefers swarm name, then binding, conversation, session, then id', () => {
    assert.equal(
      pickAgentSessionTitle({
        swarmName: '  Leaf  ',
        bindingTitle: 'bound',
        conversationTitle: 'chat',
        sessionTitle: 'tab',
        conversationId: 'c1'
      }),
      'Leaf'
    )
    assert.equal(
      pickAgentSessionTitle({
        conversationTitle: '  chat  ',
        sessionTitle: 'tab',
        conversationId: 'c1'
      }),
      'chat'
    )
    assert.equal(pickAgentSessionTitle({ conversationId: 'c1' }), 'c1')
  })
})
