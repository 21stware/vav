import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatSecretToolResult,
  isValidEnvName,
  normalizeSecretAnswerPayload,
  normalizeSecretRequests,
  normalizeSecretValues,
  parseSecretAnswer,
  secretResultLooksDeclined,
  splitDescriptionParts,
  summarizeSecretRequests
} from './sessionSecrets.ts'

describe('isValidEnvName', () => {
  it('accepts POSIX env names and rejects junk', () => {
    assert.equal(isValidEnvName('OPENAI_API_KEY'), true)
    assert.equal(isValidEnvName('_private'), true)
    assert.equal(isValidEnvName('A1'), true)
    assert.equal(isValidEnvName('1BAD'), false)
    assert.equal(isValidEnvName('HAS-DASH'), false)
    assert.equal(isValidEnvName(''), false)
  })
})

describe('normalizeSecretRequests', () => {
  it('keeps unique valid names and optional descriptions', () => {
    const rows = normalizeSecretRequests({
      title: 'Tokens',
      secrets: [
        { name: 'OPENAI_API_KEY', description: 'https://platform.openai.com/api-keys' },
        { name: '1BAD' },
        { variable: 'OPENAI_API_KEY' },
        { env: 'GH_TOKEN', hint: 'GitHub settings' }
      ]
    })
    assert.deepEqual(rows, [
      { name: 'OPENAI_API_KEY', description: 'https://platform.openai.com/api-keys' },
      { name: 'GH_TOKEN', description: 'GitHub settings' }
    ])
    assert.equal(summarizeSecretRequests(rows, 'Tokens'), 'Tokens')
    assert.equal(summarizeSecretRequests(rows.slice(0, 1)), 'OPENAI_API_KEY')
  })
})

describe('normalizeSecretValues / parseSecretAnswer', () => {
  it('keeps only allowed string values', () => {
    assert.deepEqual(
      normalizeSecretValues({ OPENAI_API_KEY: ' sk-x ', BAD: 'no', EMPTY: '  ' }, new Set(['OPENAI_API_KEY'])),
      { OPENAI_API_KEY: 'sk-x' }
    )
  })

  it('treats decline words and empty / raw text as declined (never leaks a paste)', () => {
    assert.deepEqual(parseSecretAnswer('decline'), { declined: true })
    assert.deepEqual(parseSecretAnswer('拒绝'), { declined: true })
    assert.deepEqual(parseSecretAnswer('sk-secret-value'), { declined: true })
    assert.deepEqual(parseSecretAnswer('{"declined":true}'), { declined: true })
  })

  it('accepts structured values without putting them in the parsed shape as free text', () => {
    const parsed = parseSecretAnswer('{"values":{"OPENAI_API_KEY":"sk-live"}}')
    assert.equal(parsed.declined, false)
    assert.deepEqual(parsed.values, { OPENAI_API_KEY: 'sk-live' })
    assert.deepEqual(
      normalizeSecretAnswerPayload(parsed, new Set(['OPENAI_API_KEY', 'OTHER'])),
      { declined: false, values: { OPENAI_API_KEY: 'sk-live' } }
    )
    assert.deepEqual(normalizeSecretAnswerPayload({ declined: false, values: {} }, new Set(['A'])), {
      declined: true,
      values: {}
    })
  })
})

describe('formatSecretToolResult', () => {
  it('names granted vars and never includes values', () => {
    const granted = formatSecretToolResult({
      declined: false,
      granted: ['OPENAI_API_KEY', 'GH_TOKEN'],
      skipped: ['STRIPE_KEY']
    })
    assert.match(granted, /OPENAI_API_KEY/)
    assert.match(granted, /GH_TOKEN/)
    assert.match(granted, /STRIPE_KEY/)
    assert.doesNotMatch(granted, /sk-/)
    assert.equal(secretResultLooksDeclined(granted), false)

    const declined = formatSecretToolResult({
      declined: true,
      granted: [],
      skipped: ['OPENAI_API_KEY']
    })
    assert.match(declined, /declined/)
    assert.match(declined, /OPENAI_API_KEY/)
    assert.equal(secretResultLooksDeclined(declined), true)
  })
})

describe('splitDescriptionParts', () => {
  it('turns http(s) URLs into clickable parts', () => {
    const parts = splitDescriptionParts('Create a token at https://example.com/tokens then paste it.')
    assert.deepEqual(parts, [
      { text: 'Create a token at ' },
      { text: 'https://example.com/tokens', href: 'https://example.com/tokens' },
      { text: ' then paste it.' }
    ])
  })
})
