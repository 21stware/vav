import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_THINKING_LEVEL,
  deepSeekEffort,
  grokEffortId,
  isDeepSeekModel,
  isGrokEffortId,
  parseThinkingLevel,
  sessionShowsFast,
  sessionShowsThinking,
  thinkingLevelsForSession,
  thinkingSeconds,
  toPiReasoning,
  vavModelSupportsThinking
} from './thinkingLevel.ts'

describe('parseThinkingLevel', () => {
  it('keeps known levels', () => {
    assert.equal(parseThinkingLevel('off'), 'off')
    assert.equal(parseThinkingLevel('low'), 'low')
    assert.equal(parseThinkingLevel('medium'), 'medium')
    assert.equal(parseThinkingLevel('high'), 'high')
    assert.equal(parseThinkingLevel('max'), 'max')
  })

  it('falls back to high', () => {
    assert.equal(parseThinkingLevel(undefined), DEFAULT_THINKING_LEVEL)
    assert.equal(parseThinkingLevel(''), DEFAULT_THINKING_LEVEL)
    assert.equal(parseThinkingLevel('xhigh'), DEFAULT_THINKING_LEVEL)
    assert.equal(parseThinkingLevel(1), DEFAULT_THINKING_LEVEL)
  })
})

describe('toPiReasoning', () => {
  it('omits off and passes the rest through', () => {
    assert.equal(toPiReasoning('off'), undefined)
    assert.equal(toPiReasoning('low'), 'low')
    assert.equal(toPiReasoning('max'), 'max')
  })
})

describe('sessionShowsThinking / sessionShowsFast', () => {
  it('shows thinking on VAV and Cursor, fast only on Cursor', () => {
    assert.equal(sessionShowsThinking(null, 'deepseek-v4-pro'), true)
    assert.equal(sessionShowsThinking('cursor', 'grok-4.6'), true)
    assert.equal(sessionShowsThinking('cursor', 'grok-4.6-low-fast'), true)
    assert.equal(sessionShowsThinking('cursor', 'auto'), false)
    assert.equal(sessionShowsThinking('claude', 'sonnet'), false)
    assert.equal(sessionShowsThinking('grok', 'grok-4.5'), true)
    assert.equal(sessionShowsThinking('grok', null), true)
    assert.equal(sessionShowsFast('cursor'), true)
    assert.equal(sessionShowsFast('grok'), false)
    assert.equal(sessionShowsFast(null), false)
  })
})

describe('grokEffortId', () => {
  it('maps VAV levels onto grok session/set_mode ids', () => {
    assert.equal(grokEffortId('off'), 'low')
    assert.equal(grokEffortId('low'), 'low')
    assert.equal(grokEffortId('medium'), 'medium')
    assert.equal(grokEffortId('high'), 'high')
    assert.equal(grokEffortId('max'), 'high')
    assert.equal(isGrokEffortId('plan'), false)
    assert.equal(isGrokEffortId('high'), true)
  })
})

describe('thinkingLevelsForSession', () => {
  it('locks Kimi to the advertised ACP level', () => {
    assert.deepEqual(
      thinkingLevelsForSession({
        cliHost: 'cursor',
        modelId: 'kimi-k3',
        acpThinkingLevels: ['max']
      }),
      ['max']
    )
    assert.deepEqual(
      thinkingLevelsForSession({
        cliHost: 'cursor',
        modelId: 'kimi-k3',
        catalogueDefault: 'max'
      }),
      ['max']
    )
  })

  it('keeps the full set for Grok overlays', () => {
    assert.deepEqual(
      thinkingLevelsForSession({ cliHost: 'cursor', modelId: 'grok-4.6' }),
      ['off', 'low', 'medium', 'high', 'max']
    )
  })

  it('uses grok effort ids, not off/max', () => {
    assert.deepEqual(thinkingLevelsForSession({ cliHost: 'grok', modelId: 'grok-4.5' }), [
      'low',
      'medium',
      'high'
    ])
  })
})

describe('vavModelSupportsThinking', () => {
  it('enables DeepSeek V4 and Claude 4 presets', () => {
    assert.equal(vavModelSupportsThinking('deepseek-v4-pro'), true)
    assert.equal(vavModelSupportsThinking('deepseek-v4-flash'), true)
    assert.equal(vavModelSupportsThinking('deepseek-v4-flash-vision-exp'), true)
    assert.equal(vavModelSupportsThinking('claude-sonnet-4-20250514'), true)
    assert.equal(vavModelSupportsThinking('claude-opus-4-20250514'), true)
  })

  it('disables known non-thinking presets', () => {
    assert.equal(vavModelSupportsThinking('gpt-4o'), false)
    assert.equal(vavModelSupportsThinking('claude-3-5-haiku-20241022'), false)
  })

  it('keeps custom ids on so Off remains reachable', () => {
    assert.equal(vavModelSupportsThinking('my-proxy-r1'), true)
  })
})

describe('isDeepSeekModel', () => {
  it('matches DeepSeek ids', () => {
    assert.equal(isDeepSeekModel('deepseek-v4-pro'), true)
    assert.equal(isDeepSeekModel('claude-sonnet-4-20250514'), false)
  })
})

describe('deepSeekEffort', () => {
  it('maps product levels onto DeepSeek V4', () => {
    assert.equal(deepSeekEffort('off'), null)
    assert.equal(deepSeekEffort('low'), 'low')
    assert.equal(deepSeekEffort('medium'), 'high')
    assert.equal(deepSeekEffort('high'), 'high')
    assert.equal(deepSeekEffort('max'), 'max')
  })
})

describe('thinkingSeconds', () => {
  it('rounds to whole seconds and floors a burst at 1', () => {
    assert.equal(thinkingSeconds(400), 1)
    assert.equal(thinkingSeconds(1499), 1)
    assert.equal(thinkingSeconds(1500), 2)
    assert.equal(thinkingSeconds(0), 1)
  })
})
