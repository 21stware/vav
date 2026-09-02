import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  contextSizeFromListedModels,
  contextSizeFromModelId,
  isSessionLevelAcpUpdate,
  readAcpUsageFromPromptResult,
  readAcpUsageFromUpdate
} from './acpUsage.ts'

describe('readAcpUsageFromPromptResult', () => {
  it('reads Grok camelCase counters directly on _meta', () => {
    const sample = readAcpUsageFromPromptResult({
      stopReason: 'end_turn',
      _meta: {
        sessionId: 'sess-1',
        modelId: 'grok-4.5',
        totalTokens: 1700,
        inputTokens: 1500,
        outputTokens: 200,
        cachedReadTokens: 1000,
        reasoningTokens: 75
      }
    })
    assert.deepEqual(sample, {
      contextUsed: 1500,
      contextSize: undefined,
      inputTokens: 500,
      outputTokens: 200,
      cacheRead: 1000,
      cacheWrite: undefined,
      sessionCostUsd: undefined,
      turnCostUsd: undefined
    })
  })

  it('reads ACP PromptResponse.usage', () => {
    const sample = readAcpUsageFromPromptResult({
      stopReason: 'end_turn',
      usage: {
        totalTokens: 12345,
        inputTokens: 10000,
        outputTokens: 2000,
        thoughtTokens: 300,
        cachedReadTokens: 5000,
        cachedWriteTokens: 12
      }
    })
    assert.equal(sample?.inputTokens, 5000)
    assert.equal(sample?.outputTokens, 2000)
    assert.equal(sample?.cacheRead, 5000)
    assert.equal(sample?.cacheWrite, 12)
    assert.equal(sample?.contextUsed, 10000)
  })

  it('falls back to nested _meta.usage when top-level usage is empty', () => {
    const sample = readAcpUsageFromPromptResult({
      stopReason: 'end_turn',
      usage: {},
      _meta: { usage: { prompt_tokens: 80, completion_tokens: 20, cached_tokens: 10 } }
    })
    assert.equal(sample?.inputTokens, 70)
    assert.equal(sample?.outputTokens, 20)
    assert.equal(sample?.cacheRead, 10)
    assert.equal(sample?.contextUsed, 80)
  })

  it('prefers a populated top-level usage over _meta', () => {
    const sample = readAcpUsageFromPromptResult({
      usage: { inputTokens: 9, outputTokens: 1 },
      _meta: { inputTokens: 1500, outputTokens: 200 }
    })
    assert.equal(sample?.inputTokens, 9)
    assert.equal(sample?.outputTokens, 1)
  })

  it('uses Grok _meta.totalTokens as context fill when per-turn keys are absent', () => {
    const sample = readAcpUsageFromPromptResult({
      stopReason: 'end_turn',
      _meta: { sessionId: 'sess-1', modelId: 'grok-4.5', totalTokens: 42_000 }
    })
    assert.equal(sample?.contextUsed, 42_000)
    assert.equal(sample?.inputTokens, undefined)
  })

  it('returns null when _meta has no token keys', () => {
    assert.equal(
      readAcpUsageFromPromptResult({
        stopReason: 'end_turn',
        _meta: { sessionId: 'sess-1', modelId: 'grok-4.5' }
      }),
      null
    )
  })
})

describe('readAcpUsageFromUpdate', () => {
  it('reads the stable usage_update used/size/cost shape', () => {
    const sample = readAcpUsageFromUpdate({
      sessionUpdate: 'usage_update',
      used: 53000,
      size: 200000,
      cost: { amount: 0.045, currency: 'USD' }
    })
    assert.deepEqual(sample, {
      contextUsed: 53000,
      contextSize: 200000,
      inputTokens: undefined,
      outputTokens: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
      sessionCostUsd: 0.045,
      turnCostUsd: undefined
    })
  })

  it('reads Grok turn_completed usage and costUsdTicks', () => {
    const sample = readAcpUsageFromUpdate({
      sessionUpdate: 'turn_completed',
      usage: {
        inputTokens: 16073,
        outputTokens: 247,
        cachedReadTokens: 11264,
        cacheCreationTokens: 0,
        costUsdTicks: 144_792_000
      }
    })
    assert.equal(sample?.inputTokens, 4809)
    assert.equal(sample?.cacheRead, 11264)
    assert.equal(sample?.outputTokens, 247)
    assert.equal(sample?.contextUsed, 16073)
    assert.ok(sample?.turnCostUsd != null)
    assert.ok(Math.abs(sample!.turnCostUsd! - 144_792_000 / 10_000_000_000) < 1e-12)
  })

  it('accepts nested tokens / context aliases used by some hosts', () => {
    const sample = readAcpUsageFromUpdate({
      sessionUpdate: 'usage_update',
      tokens: { usedTokens: 120, maxTokens: 8000, input: 90, output: 30 },
      context: { used: 120, size: 8000 }
    })
    assert.equal(sample?.contextUsed, 120)
    assert.equal(sample?.contextSize, 8000)
    assert.equal(sample?.inputTokens, 90)
    assert.equal(sample?.outputTokens, 30)
  })
})

describe('isSessionLevelAcpUpdate', () => {
  it('lets usage_update through after the prompt RPC settles', () => {
    assert.equal(isSessionLevelAcpUpdate('usage_update', { used: 1, size: 2 }), true)
    assert.equal(isSessionLevelAcpUpdate('usageUpdate', {}), true)
    assert.equal(isSessionLevelAcpUpdate('turn_completed', {}), true)
    assert.equal(
      isSessionLevelAcpUpdate('state_update', { usage: { inputTokens: 1 } }),
      true
    )
    assert.equal(isSessionLevelAcpUpdate('available_commands_update', {}), true)
    assert.equal(isSessionLevelAcpUpdate('current_mode_update', {}), true)
    assert.equal(isSessionLevelAcpUpdate('config_option_update', {}), true)
    assert.equal(isSessionLevelAcpUpdate('session_info_update', {}), true)
    assert.equal(isSessionLevelAcpUpdate('session_summary_generated', {}), true)
    assert.equal(isSessionLevelAcpUpdate('model_changed', {}), true)
    assert.equal(isSessionLevelAcpUpdate('agent_message_chunk', { content: {} }), false)
    assert.equal(isSessionLevelAcpUpdate('tool_call', { toolCallId: '1' }), false)
  })
})

describe('contextSizeFromModelId', () => {
  it('parses the cursor-agent bracket syntax', () => {
    assert.equal(
      contextSizeFromModelId('claude-fable-5[thinking=true,context=300k,effort=high]'),
      300_000
    )
    assert.equal(
      contextSizeFromModelId('gpt-5.6-sol[context=272k,reasoning=medium,fast=false]'),
      272_000
    )
    assert.equal(contextSizeFromModelId('big-model[context=1m]'), 1_000_000)
    assert.equal(contextSizeFromModelId('raw[context=200000]'), 200_000)
  })

  it('ignores ids without a context marker or with noise values', () => {
    assert.equal(contextSizeFromModelId('grok-4.6[effort=high,fast=true]'), undefined)
    assert.equal(contextSizeFromModelId('default[]'), undefined)
    assert.equal(contextSizeFromModelId('plain-model'), undefined)
    assert.equal(contextSizeFromModelId('weird[context=0]'), undefined)
    assert.equal(contextSizeFromModelId(''), undefined)
    assert.equal(contextSizeFromModelId(null), undefined)
    // `context` must be a bracket attribute, not part of the name.
    assert.equal(contextSizeFromModelId('context=300k'), undefined)
  })

  it('reads Grok availableModels _meta.totalContextTokens', () => {
    assert.equal(
      contextSizeFromListedModels(
        {
          currentModelId: 'grok-4.5',
          availableModels: [
            {
              modelId: 'grok-4.5',
              name: 'Grok 4.5',
              _meta: { totalContextTokens: 500_000 }
            }
          ]
        },
        'grok-4.5'
      ),
      500_000
    )
  })
})
