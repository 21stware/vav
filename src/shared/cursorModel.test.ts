import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collapseCursorListModels,
  cursorModelFamilyId,
  normalizeCursorConversationModel,
  prefsFromCursorModelId
} from './cursorModel.ts'

describe('cursorModelFamilyId', () => {
  it('strips effort / fast suffixes and the cursor- prefix', () => {
    assert.equal(cursorModelFamilyId('grok-4.6-low-fast'), 'grok-4.6')
    assert.equal(cursorModelFamilyId('cursor-grok-4.6-high-fast'), 'grok-4.6')
    assert.equal(cursorModelFamilyId('claude-fable-5-thinking-high'), 'claude-fable-5')
    assert.equal(cursorModelFamilyId('auto'), 'auto')
  })
})

describe('normalizeCursorConversationModel', () => {
  it('keeps a family id as-is and does not invent prefs', () => {
    assert.deepEqual(normalizeCursorConversationModel('grok-4.6'), {
      model: 'grok-4.6',
      thinkingLevel: undefined,
      fast: undefined,
      migrated: false
    })
  })

  it('migrates leftover --list-models ids onto family + fast', () => {
    const normalized = normalizeCursorConversationModel('grok-4.6-low-fast')
    assert.equal(normalized.model, 'grok-4.6')
    assert.equal(normalized.thinkingLevel, 'low')
    assert.equal(normalized.fast, true)
    assert.equal(normalized.migrated, true)
  })
})

describe('prefsFromCursorModelId', () => {
  it('reads reasoning / effort / fast from an ACP id', () => {
    assert.deepEqual(prefsFromCursorModelId('kimi-k3[reasoning=max]'), {
      thinkingLevel: 'max',
      fast: undefined
    })
    assert.deepEqual(prefsFromCursorModelId('grok-4.6[effort=low,fast=true]'), {
      thinkingLevel: 'low',
      fast: true
    })
    assert.equal(prefsFromCursorModelId('claude-sonnet-4[thinking=false,context=200k]').thinkingLevel, 'off')
  })
})

describe('collapseCursorListModels', () => {
  it('keeps the first family row', () => {
    const collapsed = collapseCursorListModels([
      { id: 'grok-4.6-low-fast', label: 'Grok 4.6 Low Fast' },
      { id: 'grok-4.6-high', label: 'Grok 4.6 High' }
    ])
    assert.deepEqual(
      collapsed.map((m) => m.id),
      ['grok-4.6']
    )
    assert.equal(collapsed[0]?.label, 'Grok 4.6')
  })

  it('records Kimi variant levels and the unlabeled default', () => {
    const collapsed = collapseCursorListModels([
      { id: 'kimi-k3-low', label: 'Kimi K3 Low' },
      { id: 'kimi-k3-high', label: 'Kimi K3 High' },
      { id: 'kimi-k3-max', label: 'Kimi K3' }
    ])
    assert.deepEqual(collapsed[0]?.thinkingLevels, ['low', 'high', 'max'])
    assert.equal(collapsed[0]?.defaultThinkingLevel, 'max')
  })
})
