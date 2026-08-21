import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  orderVavModels,
  pickVavDefaultModel,
  prettyVavModelLabel,
  vavFallbackModels,
  VAV_DEFAULT_MODEL_ID,
  VAV_LEGACY_DEFAULT_MODELS
} from './vavModelList.ts'

describe('vavFallbackModels', () => {
  it('uses the product default when nothing is stored', () => {
    const list = vavFallbackModels(null)
    assert.equal(list.length, 1)
    assert.equal(list[0]?.id, VAV_DEFAULT_MODEL_ID)
  })

  it('keeps a stored default id', () => {
    assert.equal(vavFallbackModels('deepseek-v4-pro')[0]?.id, 'deepseek-v4-pro')
  })
})

describe('pickVavDefaultModel', () => {
  it('keeps a live id that is still offered', () => {
    assert.equal(
      pickVavDefaultModel('deepseek-v4-pro', ['deepseek-v4-flash', 'deepseek-v4-pro']),
      'deepseek-v4-pro'
    )
  })

  it('prefers the vision default when the current id is gone', () => {
    assert.equal(
      pickVavDefaultModel('gpt-4o', [
        'deepseek-v4-pro',
        VAV_DEFAULT_MODEL_ID,
        'deepseek-v4-flash'
      ]),
      VAV_DEFAULT_MODEL_ID
    )
  })

  it('falls back to the first live id', () => {
    assert.equal(pickVavDefaultModel('gone', ['claude-sonnet-4-5']), 'claude-sonnet-4-5')
  })
})

describe('orderVavModels', () => {
  it('pins the preferred id first', () => {
    const ordered = orderVavModels(
      [
        { id: 'deepseek-v4-pro', label: 'Pro' },
        { id: VAV_DEFAULT_MODEL_ID, label: 'Vision' },
        { id: 'deepseek-v4-flash', label: 'Flash' }
      ],
      VAV_DEFAULT_MODEL_ID
    )
    assert.equal(ordered[0]?.id, VAV_DEFAULT_MODEL_ID)
  })
})

describe('prettyVavModelLabel', () => {
  it('names the vision default', () => {
    assert.equal(
      prettyVavModelLabel(VAV_DEFAULT_MODEL_ID),
      'DeepSeek V4 Flash Vision Exp'
    )
  })
})

describe('VAV_LEGACY_DEFAULT_MODELS', () => {
  it('covers the previous product defaults', () => {
    assert.ok(VAV_LEGACY_DEFAULT_MODELS.includes('deepseek-v4-pro'))
    assert.ok(VAV_LEGACY_DEFAULT_MODELS.includes('deepseek-chat'))
  })
})
