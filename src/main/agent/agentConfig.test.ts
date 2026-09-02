import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_CLI_AGENTS } from '../../shared/types.ts'
import { agentConfigForHost, mergeVavCredentials } from './agentConfig.ts'

describe('agentConfigForHost', () => {
  it('finds an enabled catalogue entry and skips disabled hosts', () => {
    assert.equal(agentConfigForHost('claude', DEFAULT_CLI_AGENTS)?.id, 'claude')
    const disabled = DEFAULT_CLI_AGENTS.map((agent) =>
      agent.id === 'claude' ? { ...agent, enabled: false } : agent
    )
    assert.equal(agentConfigForHost('claude', disabled), null)
  })
})

describe('mergeVavCredentials', () => {
  it('keeps settings when unresolved and overlays a session endpoint', () => {
    const settings = { apiEndpoint: 'https://api.deepseek.com', extra: 1 }
    assert.deepEqual(mergeVavCredentials(settings, null, 'legacy'), {
      apiKey: 'legacy',
      settings
    })
    const merged = mergeVavCredentials(
      settings,
      { apiKey: 'sess', endpoint: ' https://openrouter.ai/api/v1 ' },
      'legacy'
    )
    assert.equal(merged.apiKey, 'sess')
    assert.equal(merged.settings.apiEndpoint, 'https://openrouter.ai/api/v1')
    assert.equal(merged.settings.extra, 1)
    assert.equal(
      mergeVavCredentials(settings, { apiKey: 'sess', endpoint: '  ' }, 'legacy').settings
        .apiEndpoint,
      'https://api.deepseek.com'
    )
  })
})
