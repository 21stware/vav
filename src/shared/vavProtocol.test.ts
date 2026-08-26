import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectProtocol } from './vavProtocol.ts'

describe('detectProtocol', () => {
  it('uses OpenAI completions for DeepSeek models, even on an Anthropic host', () => {
    assert.equal(detectProtocol('https://api.anthropic.com', 'deepseek-v4-flash'), 'openai')
    assert.equal(detectProtocol('https://api.deepseek.com', 'deepseek-v4-pro'), 'openai')
    assert.equal(detectProtocol('https://api.deepseek.com/v1', 'deepseek-v4-flash'), 'openai')
  })

  it('keeps DeepSeek Anthropic Messages mounts on the Anthropic protocol', () => {
    assert.equal(
      detectProtocol('https://api.deepseek.com/anthropic', 'deepseek-v4-pro'),
      'anthropic'
    )
  })

  it('still detects Claude endpoints as Anthropic', () => {
    assert.equal(
      detectProtocol('https://api.anthropic.com', 'claude-sonnet-4-20250514'),
      'anthropic'
    )
  })

  it('detects Google AI Studio endpoints as google', () => {
    assert.equal(
      detectProtocol('https://generativelanguage.googleapis.com', 'gemini-3-pro-preview'),
      'google'
    )
    assert.equal(
      detectProtocol('https://generativelanguage.googleapis.com/v1beta', ''),
      'google'
    )
  })

  it('keeps OpenAI-compat gemini proxies on the OpenAI protocol', () => {
    assert.equal(detectProtocol('https://api.openai.com', 'gemini-2.5-pro'), 'openai')
    assert.equal(
      detectProtocol('https://openrouter.ai/api/v1', 'google/gemini-2.5-pro'),
      'openai'
    )
  })

  it('uses OpenAI completions for Zhipu BigModel and Kimi', () => {
    assert.equal(detectProtocol('https://open.bigmodel.cn/api/paas/v4', 'glm-4.6'), 'openai')
    assert.equal(detectProtocol('https://api.z.ai/api/paas/v4', ''), 'openai')
    assert.equal(detectProtocol('https://api.moonshot.cn/v1', 'kimi-k2'), 'openai')
    assert.equal(detectProtocol('https://api.moonshot.ai/v1', 'moonshot-v1-128k'), 'openai')
  })
})
