import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_CLI_AGENTS } from '../../shared/types.ts'
import { agentConfigForHost } from './agentConfig.ts'

describe('agentConfigForHost', () => {
  it('finds an enabled catalogue entry and skips disabled hosts', () => {
    assert.equal(agentConfigForHost('claude', DEFAULT_CLI_AGENTS)?.id, 'claude')
    const disabled = DEFAULT_CLI_AGENTS.map((agent) =>
      agent.id === 'claude' ? { ...agent, enabled: false } : agent
    )
    assert.equal(agentConfigForHost('claude', disabled), null)
  })
})
