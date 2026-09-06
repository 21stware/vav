import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  catalogRowForModel,
  detectModelDialect,
  encodeCursorAcpModelId,
  encodeCursorCliModelId,
  parseHostModelId,
  presentHostCatalog,
  sessionModelIsAtomic
} from './hostModelCodec.ts'

const LIST_MODELS = [
  { id: 'cursor-grok-4.6-low', label: 'Cursor Grok 4.6 Low' },
  { id: 'cursor-grok-4.6-medium', label: 'Cursor Grok 4.6 Medium' },
  { id: 'cursor-grok-4.6-high-fast', label: 'Cursor Grok 4.6 Fast' },
  { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash Medium' },
  { id: 'auto', label: 'Auto' }
]

const ACP_AVAILABLE = [
  { id: 'default[]', name: 'Auto' },
  { id: 'grok-4.6[effort=high,fast=true]', name: 'grok-4.6' },
  { id: 'gemini-3.7-flash[effort=high]', name: 'gemini-3.7-flash' },
  { id: 'gemini-3.8-flash[reasoning_effort=high]', name: 'gemini-3.8-flash' },
  { id: 'claude-opus-5[thinking=true,context=300k,effort=high,fast=false]', name: 'claude-opus-5' }
]

describe('detectModelDialect', () => {
  it('classifies hyphen catalogues as cursor-cli and brackets as cursor-acp', () => {
    assert.equal(detectModelDialect(LIST_MODELS), 'cursor-cli')
    assert.equal(detectModelDialect(ACP_AVAILABLE), 'cursor-acp')
  })
})

describe('parseHostModelId', () => {
  it('treats hyphen variants as atomic and brackets as parameterized', () => {
    const hyphen = parseHostModelId('cursor-grok-4.6-medium')
    assert.equal(hyphen.arity, 'atomic')
    assert.equal(hyphen.family, 'grok-4.6')
    assert.equal(hyphen.dialect, 'cursor-cli')

    const bracket = parseHostModelId('grok-4.6[effort=high,fast=true]')
    assert.equal(bracket.arity, 'parameterized')
    assert.equal(bracket.family, 'grok-4.6')
    assert.equal(bracket.dialect, 'cursor-acp')
    assert.equal(bracket.params.find((param) => param.key === 'thinking')?.value, 'high')
  })
})

describe('presentHostCatalog', () => {
  it('keeps hyphen --list-models rows atomic', () => {
    const presented = presentHostCatalog(LIST_MODELS)
    assert.deepEqual(
      presented.map((row) => row.id),
      [
        'cursor-grok-4.6-low',
        'cursor-grok-4.6-medium',
        'cursor-grok-4.6-high-fast',
        'gemini-3.7-flash-medium',
        'auto'
      ]
    )
    assert.equal(presented[0]?.label, 'Cursor Grok 4.6 Low')
  })

  it('collapses ACP bracket rows onto the family', () => {
    const presented = presentHostCatalog(
      ACP_AVAILABLE.map((row) => ({ id: row.id, label: row.name ?? row.id }))
    )
    assert.deepEqual(
      presented.map((row) => row.id),
      ['auto', 'grok-4.6', 'gemini-3.7-flash', 'gemini-3.8-flash', 'claude-opus-5']
    )
  })
})

describe('catalogRowForModel', () => {
  it('prefers an exact id then the family', () => {
    const list = presentHostCatalog(LIST_MODELS)
    assert.equal(catalogRowForModel(list, 'cursor-grok-4.6-medium')?.id, 'cursor-grok-4.6-medium')
    assert.equal(catalogRowForModel(list, 'grok-4.6')?.id, 'cursor-grok-4.6-low')
  })
})

describe('encodeCursorCliModelId', () => {
  it('never emits a bracket string', () => {
    assert.equal(
      encodeCursorCliModelId('grok-4.6', { thinkingLevel: 'medium', fast: false }),
      'cursor-grok-4.6-medium'
    )
    assert.equal(encodeCursorCliModelId('cursor-grok-4.6-medium'), 'cursor-grok-4.6-medium')
    assert.equal(
      encodeCursorCliModelId('cursor-grok-4.6-medium', { thinkingLevel: 'high', fast: true }),
      'cursor-grok-4.6-medium'
    )
    assert.equal(
      encodeCursorCliModelId('grok-4.6[effort=medium,fast=false]'),
      'cursor-grok-4.6-medium'
    )
    assert.equal(
      encodeCursorCliModelId('gemini-3.7-flash', { thinkingLevel: 'medium' }),
      'gemini-3.7-flash-medium'
    )
    assert.equal(
      encodeCursorCliModelId('gemini-3.8-flash', { thinkingLevel: 'medium' }),
      'gemini-3.8-flash-medium'
    )
    assert.equal(encodeCursorCliModelId('auto'), 'auto')
    assert.equal(encodeCursorCliModelId(''), null)
    assert.ok(!encodeCursorCliModelId('grok-4.6', { thinkingLevel: 'medium' })?.includes('['))
  })
})

describe('encodeCursorAcpModelId', () => {
  it('returns the advertised family row and never invents an overlay', () => {
    assert.equal(
      encodeCursorAcpModelId('grok-4.6', ACP_AVAILABLE),
      'grok-4.6[effort=high,fast=true]'
    )
    assert.equal(
      encodeCursorAcpModelId('cursor-grok-4.6-medium', ACP_AVAILABLE),
      'grok-4.6[effort=high,fast=true]'
    )
    assert.equal(
      encodeCursorAcpModelId('gemini-3.8-flash', ACP_AVAILABLE),
      'gemini-3.8-flash[reasoning_effort=high]'
    )
    assert.equal(encodeCursorAcpModelId('auto', ACP_AVAILABLE), 'default[]')
    assert.equal(encodeCursorAcpModelId('grok-4.6', []), null)
  })
})

describe('sessionModelIsAtomic', () => {
  it('hides chips for hyphen Cursor ids', () => {
    assert.equal(sessionModelIsAtomic('cursor', 'cursor-grok-4.6-medium'), true)
    assert.equal(sessionModelIsAtomic('cursor', 'grok-4.6'), false)
    assert.equal(sessionModelIsAtomic('grok', 'cursor-grok-4.6-medium'), false)
  })
})
