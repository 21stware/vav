import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { conversationProviderId, DEFAULT_PROVIDER_ID } from './cliHost.ts'

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
