import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  conversationProviderId,
  DEFAULT_PROVIDER_ID,
  isAcpCliHost
} from './cliHost.ts'

describe('conversationProviderId', () => {
  it('uses the structured CLI host when set', () => {
    assert.equal(conversationProviderId({ cliHost: 'grok', agentBinaryName: 'claude' }), 'grok')
  })

  it('falls back to the agent binary when there is no host', () => {
    assert.equal(conversationProviderId({ cliHost: null, agentBinaryName: 'cursor' }), 'cursor')
  })

  it('buckets the built-in agent as VAV', () => {
    assert.equal(conversationProviderId({ cliHost: null, agentBinaryName: null }), DEFAULT_PROVIDER_ID)
    assert.equal(conversationProviderId({ cliHost: 'vav', agentBinaryName: 'vav' }), DEFAULT_PROVIDER_ID)
    assert.equal(conversationProviderId({}), DEFAULT_PROVIDER_ID)
  })
})

describe('isAcpCliHost', () => {
  it('is true only for ACP-transport CLI ids', () => {
    assert.equal(isAcpCliHost(null), false)
    assert.equal(isAcpCliHost(undefined), false)
    assert.equal(isAcpCliHost('claude'), false)
    assert.equal(isAcpCliHost('codex'), false)
    assert.equal(isAcpCliHost('cursor'), true)
    assert.equal(isAcpCliHost('grok'), true)
    assert.equal(isAcpCliHost('devin'), true)
    assert.equal(isAcpCliHost('kiro'), true)
    assert.equal(isAcpCliHost('cline'), true)
  })
})
