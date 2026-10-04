import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  groupAccountsByVendor,
  isLlmVendorId,
  isMagpieEndpoint,
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
    assert.equal(vendorIdFromEndpoint('https://open.bigmodel.cn/api/paas/v4'), 'bigmodel')
    assert.equal(vendorIdFromEndpoint('https://api.z.ai/api/paas/v4'), 'bigmodel')
    assert.equal(vendorFromEndpoint('https://open.bigmodel.cn/api/paas/v4')?.name, 'Zhipu')
    assert.equal(vendorIdFromEndpoint('https://api.moonshot.cn/v1'), 'kimi')
    assert.equal(vendorIdFromEndpoint('https://api.moonshot.ai/v1'), 'kimi')
    assert.equal(vendorFromEndpoint('https://api.moonshot.cn/v1')?.name, 'Kimi')
    assert.equal(vendorIdFromEndpoint('http://127.0.0.1:3425/v1'), 'magpie')
    assert.equal(vendorIdFromEndpoint('http://localhost:3425'), 'magpie')
    assert.equal(vendorIdFromEndpoint('http://[::1]:3425/v1'), 'magpie')
    assert.equal(vendorFromEndpoint('http://127.0.0.1:3425/v1')?.name, 'Magpie')
    assert.equal(vendorFromEndpoint('http://127.0.0.1:3425/v1')?.defaultApiKey, 'magpie')
  })

  it('treats unknown endpoints as custom', () => {
    assert.equal(vendorIdFromEndpoint('http://127.0.0.1:11434/v1'), 'custom')
    assert.equal(vendorIdFromEndpoint('https://usemagpie.ai'), 'custom')
    assert.equal(vendorIdFromEndpoint('https://llm.example.com/v1'), 'custom')
    assert.equal(vendorFromEndpoint('https://llm.example.com/v1'), null)
    assert.equal(vendorDisplayName('https://llm.example.com/v1', 'Custom'), 'Custom')
    assert.equal(vendorIdFromEndpoint(null), 'custom')
    assert.equal(vendorFromEndpoint(''), null)
  })

  it('recognises catalogue ids', () => {
    assert.equal(isLlmVendorId('deepseek'), true)
    assert.equal(isLlmVendorId('magpie'), true)
    assert.equal(isLlmVendorId('custom'), true)
    assert.equal(isLlmVendorId('vav'), false)
    assert.equal(isLlmVendorId('claude'), false)
    assert.equal(vendorById('openrouter')?.endpoint, 'https://openrouter.ai/api/v1')
    assert.equal(vendorById('magpie')?.endpoint, 'http://127.0.0.1:3425/v1')
  })

  it('recognises the Magpie loopback gateway', () => {
    assert.equal(isMagpieEndpoint('http://127.0.0.1:3425/v1'), true)
    assert.equal(isMagpieEndpoint('http://localhost:3425'), true)
    assert.equal(isMagpieEndpoint('http://[::1]:3425/v1'), true)
    assert.equal(isMagpieEndpoint('http://127.0.0.1:11434/v1'), false)
    assert.equal(isMagpieEndpoint('https://usemagpie.ai'), false)
    assert.equal(isMagpieEndpoint(''), false)
  })

  it('groups key accounts by vendor and keeps catalogue order', () => {
    const grouped = groupAccountsByVendor([
      { endpoint: 'https://openrouter.ai/api/v1' },
      { endpoint: 'https://api.deepseek.com' },
      { endpoint: 'https://api.deepseek.com/anthropic' },
      { endpoint: 'http://127.0.0.1:3425/v1' },
      { endpoint: 'https://llm.example.com' }
    ])
    assert.deepEqual(
      grouped.map((row) => row.vendor.id),
      ['deepseek', 'openrouter', 'magpie', 'custom']
    )
    assert.equal(grouped[0]?.accounts.length, 2)
    assert.equal(grouped[2]?.accounts.length, 1)
  })
})
