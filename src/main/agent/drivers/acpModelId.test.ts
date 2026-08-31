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
  it('maps picker aliases onto Cursor ACP parameterized ids', () => {
    assert.equal(
      resolveAcpModelId('cursor-grok-4.6-high-fast', CURSOR_AVAILABLE),
      'grok-4.6[effort=high,fast=true]'
    )
    assert.equal(
      resolveAcpModelId('cursor-grok-4.6-low', CURSOR_AVAILABLE),
      'grok-4.6[effort=low,fast=false]'
    )
    assert.equal(
      resolveAcpModelId('claude-fable-5-thinking-high', CURSOR_AVAILABLE),
      'claude-fable-5[thinking=true,context=300k,effort=high]'
    )
    assert.equal(
      resolveAcpModelId('claude-opus-5-thinking-high-fast', CURSOR_AVAILABLE),
      'claude-opus-5[thinking=true,context=300k,effort=high,fast=true]'
    )
    assert.equal(
      resolveAcpModelId('claude-opus-5-high', CURSOR_AVAILABLE),
      'claude-opus-5[thinking=false,context=300k,effort=high,fast=false]'
    )
    assert.equal(
      resolveAcpModelId('gpt-5.6-sol-xhigh-fast', CURSOR_AVAILABLE),
      'gpt-5.6-sol[context=272k,reasoning=xhigh,fast=true]'
    )
    assert.equal(
      resolveAcpModelId('gpt-5.3-codex-low-fast', CURSOR_AVAILABLE),
      'gpt-5.3-codex[reasoning=low,fast=true]'
    )
    assert.equal(
      resolveAcpModelId('composer-2.5', CURSOR_AVAILABLE),
      'composer-2.5[fast=false]'
    )
    assert.equal(
      resolveAcpModelId('composer-2.5-fast', CURSOR_AVAILABLE),
      'composer-2.5[fast=true]'
    )
    assert.equal(
      resolveAcpModelId('gemini-3.7-flash-high', CURSOR_AVAILABLE),
      'gemini-3.7-flash[effort=high]'
    )
    assert.equal(resolveAcpModelId('auto', CURSOR_AVAILABLE), 'default[]')
    assert.equal(resolveAcpModelId('default', CURSOR_AVAILABLE), 'default[]')
  })

  it('passes through exact ACP ids and plain host ids', () => {
    assert.equal(
      resolveAcpModelId('grok-4.6[effort=high,fast=true]', CURSOR_AVAILABLE),
      'grok-4.6[effort=high,fast=true]'
    )
    assert.equal(resolveAcpModelId('grok-4.5', []), 'grok-4.5')
    assert.equal(resolveAcpModelId('gemini-3.1-pro', CURSOR_AVAILABLE), 'gemini-3.1-pro[]')
  })

  it('constructs an ACP id when the session has not advertised models yet', () => {
    assert.equal(
      resolveAcpModelId('cursor-grok-4.6-high-fast', []),
      'grok-4.6[effort=high,fast=true]'
    )
    assert.equal(resolveAcpModelId('auto', []), 'default[]')
  })

  it('overlays session thinking / fast instead of baking them into the model id', () => {
    assert.equal(
      resolveAcpModelId('grok-4.6', CURSOR_AVAILABLE, { thinkingLevel: 'low', fast: true }),
      'grok-4.6[effort=low,fast=true]'
    )
    assert.equal(
      resolveAcpModelId('claude-fable-5', CURSOR_AVAILABLE, { thinkingLevel: 'off', fast: false }),
      'claude-fable-5[thinking=false,context=300k,effort=high,fast=false]'
    )
    assert.equal(
      resolveAcpModelId('gpt-5.6-sol', CURSOR_AVAILABLE, { thinkingLevel: 'max', fast: true }),
      'gpt-5.6-sol[context=272k,reasoning=max,fast=true]'
    )
    assert.equal(
      resolveAcpModelId('composer-2.5', CURSOR_AVAILABLE, { thinkingLevel: 'high', fast: false }),
      'composer-2.5[fast=false]'
    )
    assert.equal(
      resolveAcpModelId('kimi-k3', CURSOR_AVAILABLE, { thinkingLevel: 'high', fast: false }),
      'kimi-k3[reasoning=high]'
    )
    assert.equal(
      resolveAcpModelId('kimi-k3', CURSOR_AVAILABLE, { thinkingLevel: 'low' }),
      'kimi-k3[reasoning=low]'
    )
  })
})

describe('collapseCursorListModels', () => {
  it('keeps one family row and strips effort / fast from the label', () => {
    const collapsed = collapseCursorListModels([
      { id: 'cursor-grok-4.6-high-fast', label: 'Cursor Grok 4.6 Fast' },
      { id: 'cursor-grok-4.6-low', label: 'Cursor Grok 4.6 Low' },
      { id: 'claude-fable-5-thinking-high', label: 'Claude Fable 5 1M Thinking (NO ZDR)' },
      { id: 'auto', label: 'Auto (default)' }
    ])
    assert.deepEqual(
      collapsed.map((m) => m.id),
      ['grok-4.6', 'claude-fable-5', 'auto']
    )
    assert.equal(collapsed[0]?.label, 'Cursor Grok 4.6')
    assert.equal(collapsed[1]?.label, 'Claude Fable 5')
  })
})

describe('acpBootstrapModelId', () => {
  it('constructs an ACP id before the session has advertised models', () => {
    assert.equal(
      acpBootstrapModelId('grok-4.6', { thinkingLevel: 'medium', fast: false }),
      'grok-4.6[effort=medium,fast=false]'
    )
    assert.equal(
      acpBootstrapModelId('cursor-grok-4.6-high-fast'),
      'grok-4.6[effort=high,fast=true]'
    )
    assert.equal(acpBootstrapModelId(''), null)
    assert.equal(acpBootstrapModelId(null), null)
  })
})

describe('acpModelIdCandidates', () => {
  it('tries the overlaid id before the family default and the raw picker id', () => {
    assert.deepEqual(acpModelIdCandidates('cursor-grok-4.6-low', CURSOR_AVAILABLE), [
      'grok-4.6[effort=low,fast=false]',
      'grok-4.6[effort=high,fast=true]',
      'grok-4.6[effort=low]',
      'cursor-grok-4.6-low'
    ])
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
