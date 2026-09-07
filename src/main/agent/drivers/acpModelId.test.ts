import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  acpBootstrapModelId,
  acpModelIdCandidates,
  advertisedThinkingLevel,
  collapseCursorListModels,
  parseAcpAvailableModels,
  resolveAcpModelId
} from './acpModelId.ts'

const CURSOR_AVAILABLE = [
  { modelId: 'default[]', name: 'Auto' },
  { modelId: 'grok-4.6[effort=high,fast=true]', name: 'grok-4.6' },
  { modelId: 'composer-2.5[fast=true]', name: 'composer-2.5' },
  { modelId: 'claude-opus-5[thinking=true,context=300k,effort=high,fast=false]', name: 'claude-opus-5' },
  { modelId: 'gpt-5.6-sol[context=272k,reasoning=medium,fast=false]', name: 'gpt-5.6-sol' },
  { modelId: 'claude-fable-5[thinking=true,context=300k,effort=high]', name: 'claude-fable-5' },
  { modelId: 'gpt-5.3-codex[reasoning=medium,fast=false]', name: 'gpt-5.3-codex' },
  { modelId: 'gemini-3.7-flash[effort=high]', name: 'gemini-3.7-flash' },
  { modelId: 'gemini-3.1-pro[]', name: 'gemini-3.1-pro' },
  { modelId: 'kimi-k3[reasoning=max]', name: 'kimi-k3' }
]

describe('resolveAcpModelId', () => {
  it('maps picker ids onto the advertised ACP family row', () => {
    assert.equal(
      resolveAcpModelId('cursor-grok-4.6-high-fast', CURSOR_AVAILABLE),
      'grok-4.6[effort=high,fast=true]'
    )
    assert.equal(
      resolveAcpModelId('cursor-grok-4.6-low', CURSOR_AVAILABLE),
      'grok-4.6[effort=high,fast=true]'
    )
    assert.equal(
      resolveAcpModelId('claude-fable-5-thinking-high', CURSOR_AVAILABLE),
      'claude-fable-5[thinking=true,context=300k,effort=high]'
    )
    assert.equal(
      resolveAcpModelId('claude-opus-5-thinking-high-fast', CURSOR_AVAILABLE),
      'claude-opus-5[thinking=true,context=300k,effort=high,fast=false]'
    )
    assert.equal(resolveAcpModelId('auto', CURSOR_AVAILABLE), 'default[]')
    assert.equal(resolveAcpModelId('default', CURSOR_AVAILABLE), 'default[]')
    assert.equal(
      resolveAcpModelId('gemini-3.7-flash-high', CURSOR_AVAILABLE),
      'gemini-3.7-flash[effort=high]'
    )
  })

  it('passes through exact ACP ids and does not invent overlays', () => {
    assert.equal(
      resolveAcpModelId('grok-4.6[effort=high,fast=true]', CURSOR_AVAILABLE),
      'grok-4.6[effort=high,fast=true]'
    )
    assert.equal(resolveAcpModelId('grok-4.5', []), 'grok-4.5')
    assert.equal(resolveAcpModelId('gemini-3.1-pro', CURSOR_AVAILABLE), 'gemini-3.1-pro[]')
  })

  it('does not construct an overlay before the session has advertised models', () => {
    assert.equal(resolveAcpModelId('cursor-grok-4.6-high-fast', []), 'cursor-grok-4.6-high-fast')
    assert.equal(resolveAcpModelId('auto', []), 'default[]')
  })

  it('keeps a single advertised family row (no invented overlay)', () => {
    assert.equal(
      resolveAcpModelId('grok-4.6', CURSOR_AVAILABLE, { thinkingLevel: 'low', fast: true }),
      'grok-4.6[effort=high,fast=true]'
    )
    assert.equal(
      resolveAcpModelId('kimi-k3', CURSOR_AVAILABLE, { thinkingLevel: 'low' }),
      'kimi-k3[reasoning=max]'
    )
  })

  it('picks the advertised row that matches thinking / fast chips', () => {
    const listed = [
      ...CURSOR_AVAILABLE,
      { modelId: 'grok-4.6[effort=high,fast=false]', name: 'grok-4.6' },
      { modelId: 'grok-4.6[effort=low,fast=true]', name: 'grok-4.6' }
    ]
    assert.equal(
      resolveAcpModelId('grok-4.6', listed, { thinkingLevel: 'low', fast: true }),
      'grok-4.6[effort=low,fast=true]'
    )
    assert.equal(
      resolveAcpModelId('grok-4.6', listed, { thinkingLevel: 'high', fast: false }),
      'grok-4.6[effort=high,fast=false]'
    )
  })
})

describe('collapseCursorListModels', () => {
  it('keeps hyphen --list-models rows atomic', () => {
    const collapsed = collapseCursorListModels([
      { id: 'cursor-grok-4.6-high-fast', label: 'Cursor Grok 4.6 Fast' },
      { id: 'cursor-grok-4.6-low', label: 'Cursor Grok 4.6 Low' },
      { id: 'claude-fable-5-thinking-high', label: 'Claude Fable 5 1M Thinking (NO ZDR)' },
      { id: 'auto', label: 'Auto (default)' }
    ])
    assert.deepEqual(
      collapsed.map((m) => m.id),
      [
        'cursor-grok-4.6-high-fast',
        'cursor-grok-4.6-low',
        'claude-fable-5-thinking-high',
        'auto'
      ]
    )
    assert.equal(collapsed[0]?.label, 'Cursor Grok 4.6 Fast')
  })
})

describe('acpBootstrapModelId', () => {
  it('does not invent an overlay before availableModels exists', () => {
    assert.equal(acpBootstrapModelId('grok-4.6', { thinkingLevel: 'medium', fast: false }), null)
    assert.equal(acpBootstrapModelId('cursor-grok-4.6-high-fast'), null)
    assert.equal(acpBootstrapModelId(''), null)
    assert.equal(acpBootstrapModelId(null), null)
    assert.equal(acpBootstrapModelId('auto'), 'default[]')
  })
})

describe('acpModelIdCandidates', () => {
  it('only tries the advertised family row', () => {
    assert.deepEqual(acpModelIdCandidates('cursor-grok-4.6-low', CURSOR_AVAILABLE), [
      'grok-4.6[effort=high,fast=true]'
    ])
  })

  it('does not emit thinking / fast overlays', () => {
    assert.deepEqual(
      acpModelIdCandidates('grok-4.6', CURSOR_AVAILABLE, { thinkingLevel: 'high', fast: false }),
      ['grok-4.6[effort=high,fast=true]']
    )
    assert.deepEqual(
      acpModelIdCandidates('grok-4.6', CURSOR_AVAILABLE, { thinkingLevel: 'low', fast: true }),
      ['grok-4.6[effort=high,fast=true]']
    )
    assert.deepEqual(acpModelIdCandidates('grok-4.6', []), [])
  })
})

describe('advertisedThinkingLevel', () => {
  it('reads the ACP default for a locked family', () => {
    assert.equal(advertisedThinkingLevel('kimi-k3', CURSOR_AVAILABLE), 'max')
  })
})

describe('parseAcpAvailableModels', () => {
  it('reads session/new models.availableModels', () => {
    const listed = parseAcpAvailableModels({
      currentModelId: 'default[]',
      availableModels: [
        { modelId: 'default[]', name: 'Auto' },
        { modelId: 'grok-4.6[effort=high,fast=true]', name: 'grok-4.6' }
      ]
    })
    assert.equal(listed.length, 2)
    assert.equal(listed[1]?.modelId, 'grok-4.6[effort=high,fast=true]')
  })
})
