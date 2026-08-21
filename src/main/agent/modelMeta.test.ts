import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  catalogRatesFor,
  contextWindowFor,
  lookupCatalogModel,
  maxTokensFor,
  modelAcceptsImage,
  modelSupportsThinking,
  thinkingLevelMapFor
} from './modelMeta.ts'

describe('lookupCatalogModel', () => {
  it('resolves exact ids from first-party catalogs', () => {
    const meta = lookupCatalogModel('claude-sonnet-4-5')
    assert.ok(meta)
    assert.equal(meta.providerId, 'anthropic')
    assert.equal(meta.contextWindow, 1_000_000)
    assert.deepEqual(meta.input, ['text', 'image'])
  })

  it('resolves dated snapshot ids onto their base model', () => {
    const dated = lookupCatalogModel('claude-sonnet-4-5-20250929')
    assert.ok(dated)
    assert.equal(dated.providerId, 'anthropic')
    assert.equal(dated.contextWindow, lookupCatalogModel('claude-sonnet-4-5')?.contextWindow)

    const openaiDated = lookupCatalogModel('gpt-4o-2024-08-06')
    assert.ok(openaiDated)
    assert.equal(openaiDated.providerId, 'openai')
  })

  it('resolves aggregator-style ids when the user typed one', () => {
    const meta = lookupCatalogModel('anthropic/claude-sonnet-4.5')
    assert.ok(meta)
    assert.equal(meta.providerId, 'openrouter')
  })

  it('resolves case-insensitively', () => {
    const meta = lookupCatalogModel('minimax-m2.7')
    assert.ok(meta)
    assert.equal(meta.providerId, 'minimax')
  })

  it('returns null for unknown ids and empty input', () => {
    assert.equal(lookupCatalogModel('totally-unknown-model'), null)
    assert.equal(lookupCatalogModel(''), null)
    assert.equal(lookupCatalogModel(null), null)
    assert.equal(lookupCatalogModel(undefined), null)
  })

  it('does not misread a non-date numeric suffix as a snapshot stamp', () => {
    // gemini-2.0-flash-001 is itself a catalog id; nothing should strip to a
    // different model.
    const meta = lookupCatalogModel('some-model-1234')
    assert.equal(meta, null)
  })
})

describe('contextWindowFor / maxTokensFor', () => {
  it('uses catalog values for known models', () => {
    assert.equal(contextWindowFor('claude-sonnet-4-5'), 1_000_000)
    assert.ok(maxTokensFor('claude-sonnet-4-5') > 0)
    assert.equal(contextWindowFor('deepseek-v4-pro'), 1_000_000)
  })

  it('falls back to the shared regex table for unknown ids', () => {
    assert.equal(contextWindowFor('mystery-future-model'), 200_000)
    assert.equal(maxTokensFor('mystery-future-model'), 16_384)
  })
})

describe('catalogRatesFor', () => {
  it('returns catalog pricing for known models', () => {
    const rates = catalogRatesFor('claude-sonnet-4-5')
    assert.ok(rates)
    assert.equal(rates.input, 3)
    assert.equal(rates.output, 15)
    assert.equal(rates.cacheRead, 0.3)
    assert.equal(rates.cacheWrite, 3.75)
  })

  it('returns null for unknown models', () => {
    assert.equal(catalogRatesFor('no-such-model'), null)
  })
})

describe('modelSupportsThinking / modelAcceptsImage', () => {
  it('uses catalog reasoning and modality flags', () => {
    assert.equal(modelSupportsThinking('gpt-4o'), false)
    assert.equal(modelSupportsThinking('claude-sonnet-4-5'), true)
    // DeepSeek V4 is text-only even though the id family is not in the vision regex.
    assert.equal(modelAcceptsImage('deepseek-v4-pro'), false)
    assert.equal(modelAcceptsImage('deepseek-v4-flash-vision-exp'), true)
    assert.equal(modelAcceptsImage('gpt-4o'), true)
    assert.equal(modelAcceptsImage('gemini-2.5-pro') ?? modelAcceptsImage('gemini-3-pro-preview'), true)
  })

  it('falls back to shared heuristics for unknown ids', () => {
    assert.equal(modelSupportsThinking('gpt-4o-mini'), false)
    assert.equal(modelSupportsThinking('some-reasoning-model'), true)
    assert.equal(modelAcceptsImage('totally-unknown'), false)
  })
})

describe('thinkingLevelMapFor', () => {
  it('returns native level mappings for models that have one', () => {
    const map = thinkingLevelMapFor('deepseek-v4-pro')
    assert.ok(map)
    assert.equal(map.high, 'high')

    const gemini = thinkingLevelMapFor('gemini-3-pro-preview')
    assert.ok(gemini)
  })

  it('returns undefined when the catalog has no map', () => {
    assert.equal(thinkingLevelMapFor('claude-sonnet-4-5'), undefined)
    assert.equal(thinkingLevelMapFor('no-such-model'), undefined)
  })
})
