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
})
