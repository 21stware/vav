import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  groupAccountsByVendor,
  isLlmVendorId,
  vendorById,
  vendorDisplayName,
  vendorFromEndpoint,
  vendorIdFromEndpoint
} from './llmVendors.ts'

describe('llm vendors', () => {
  it('maps official endpoints to catalogue brands', () => {
    assert.equal(vendorIdFromEndpoint('https://api.deepseek.com/anthropic'), 'deepseek')
    assert.equal(vendorFromEndpoint('https://openrouter.ai/api/v1')?.name, 'OpenRouter')
    assert.equal(vendorDisplayName('https://api.x.ai/v1'), 'xAI')
    assert.equal(vendorIdFromEndpoint('https://api.openai.com/v1'), 'openai')
    assert.equal(vendorIdFromEndpoint('https://api.anthropic.com'), 'anthropic')
    assert.equal(vendorIdFromEndpoint('https://generativelanguage.googleapis.com'), 'google')
    assert.equal(vendorIdFromEndpoint('https://api.together.xyz/v1'), 'together')
    assert.equal(vendorIdFromEndpoint('https://api.siliconflow.cn/v1'), 'siliconflow')
  })

  it('treats unknown endpoints as custom', () => {
    assert.equal(vendorIdFromEndpoint('https://llm.example.com/v1'), 'custom')
    assert.equal(vendorFromEndpoint('https://llm.example.com/v1'), null)
    assert.equal(vendorDisplayName('https://llm.example.com/v1', 'Custom'), 'Custom')
    assert.equal(vendorIdFromEndpoint(null), 'custom')
    assert.equal(vendorFromEndpoint(''), null)
  })

  it('recognises catalogue ids', () => {
    assert.equal(isLlmVendorId('deepseek'), true)
    assert.equal(isLlmVendorId('custom'), true)
    assert.equal(isLlmVendorId('vav'), false)
    assert.equal(isLlmVendorId('claude'), false)
    assert.equal(vendorById('openrouter')?.endpoint, 'https://openrouter.ai/api/v1')
  })

  it('groups key accounts by vendor and keeps catalogue order', () => {
    const grouped = groupAccountsByVendor([
      { endpoint: 'https://openrouter.ai/api/v1' },
      { endpoint: 'https://api.deepseek.com' },
      { endpoint: 'https://api.deepseek.com/anthropic' },
      { endpoint: 'https://llm.example.com' }
    ])
    assert.deepEqual(
      grouped.map((row) => row.vendor.id),
      ['deepseek', 'openrouter', 'custom']
    )
    assert.equal(grouped[0]?.accounts.length, 2)
    assert.equal(grouped[2]?.accounts.length, 1)
  })
})
