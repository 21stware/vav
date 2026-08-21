import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fetchVavModels } from './vavModelProbe.ts'
import { baseUrlFor, detectProtocol } from '../../shared/vavProtocol.ts'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('fetchVavModels', () => {
  it('parses OpenAI-style model lists', async () => {
    const calls: string[] = []
    const result = await fetchVavModels({
      endpoint: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      fetchFn: async (input, init) => {
        calls.push(String(input))
        assert.equal((init as RequestInit | undefined)?.headers?.authorization, 'Bearer sk-test')
        return jsonResponse({
          data: [{ id: 'gpt-5.2' }, { id: 'text-embedding-3-small' }, { id: 'gpt-5.2' }]
        })
      }
    })
    assert.equal(result.error, undefined)
    assert.deepEqual(
      result.models.map((m) => m.id),
      ['gpt-5.2']
    )
    assert.match(calls[0]!, /\/v1\/models$/)
  })

  it('keeps live input/output modalities when the provider publishes them', async () => {
    const result = await fetchVavModels({
      endpoint: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
      fetchFn: async () =>
        jsonResponse({
          data: [
            {
              id: 'openai/gpt-4o',
              architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }
            }
          ]
        })
    })
    assert.deepEqual(result.models[0]?.input, ['text', 'image'])
    assert.deepEqual(result.models[0]?.output, ['text'])
  })

  it('parses Anthropic model lists with display names', async () => {
    const result = await fetchVavModels({
      endpoint: 'https://api.anthropic.com',
      apiKey: 'ak-test',
      fetchFn: async (input, init) => {
        const headers = (init as RequestInit | undefined)?.headers as Record<string, string>
        assert.equal(headers['x-api-key'], 'ak-test')
        assert.equal(headers['anthropic-version'], '2023-06-01')
        assert.match(String(input), /\/v1\/models/)
        return jsonResponse({
          data: [
            { id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' },
            { id: 'claude-opus-4-5', display_name: 'Claude Opus 4.5' }
          ]
        })
      }
    })
    assert.deepEqual(
      result.models.map((m) => ({ id: m.id, label: m.label })),
      [
        { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
        { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }
      ]
    )
  })

  it('parses Google model lists, generateContent only', async () => {
    const result = await fetchVavModels({
      endpoint: 'https://generativelanguage.googleapis.com',
      apiKey: 'g-test',
      fetchFn: async (input, init) => {
        const headers = (init as RequestInit | undefined)?.headers as Record<string, string>
        assert.equal(headers['x-goog-api-key'], 'g-test')
        assert.match(String(input), /\/v1beta\/models\?pageSize=/)
        return jsonResponse({
          models: [
            {
              name: 'models/gemini-3-pro-preview',
              displayName: 'Gemini 3 Pro Preview',
              supportedGenerationMethods: ['generateContent']
            },
            {
              name: 'models/text-embedding-004',
              supportedGenerationMethods: ['embedContent']
            },
            {
              name: 'tunedModels/my-tune',
              supportedGenerationMethods: ['generateContent']
            }
          ]
        })
      }
    })
    assert.deepEqual(
      result.models.map((m) => ({ id: m.id, label: m.label })),
      [{ id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' }]
    )
  })

  it('lists DeepSeek models from the OpenAI root on an /anthropic mount', async () => {
    const calls: string[] = []
    const result = await fetchVavModels({
      endpoint: 'https://api.deepseek.com/anthropic',
      apiKey: 'sk-test',
      fetchFn: async (input, init) => {
        calls.push(String(input))
        assert.equal((init as RequestInit | undefined)?.headers?.authorization, 'Bearer sk-test')
        return jsonResponse({
          data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }]
        })
      }
    })
    assert.equal(result.error, undefined)
    assert.deepEqual(
      result.models.map((m) => m.id),
      ['deepseek-v4-flash', 'deepseek-v4-pro']
    )
    assert.deepEqual(calls, ['https://api.deepseek.com/v1/models'])
  })

  it('falls through to Anthropic /v1/models when the OpenAI-compat root 404s', async () => {
    const calls: string[] = []
    const result = await fetchVavModels({
      endpoint: 'https://gateway.example/anthropic',
      apiKey: 'ak-test',
      fetchFn: async (input, init) => {
        calls.push(String(input))
        if (String(input).includes('/v1/models?limit=')) {
          const headers = (init as RequestInit | undefined)?.headers as Record<string, string>
          assert.equal(headers['x-api-key'], 'ak-test')
          return jsonResponse({ data: [{ id: 'claude-sonnet-4-5' }] })
        }
        return new Response('nope', { status: 404 })
      }
    })
    assert.deepEqual(
      result.models.map((m) => m.id),
      ['claude-sonnet-4-5']
    )
    assert.deepEqual(calls, [
      'https://gateway.example/v1/models',
      'https://gateway.example/anthropic/v1/models?limit=1000'
    ])
  })

  it('does not retry a missing-route fallback after 401', async () => {
    const calls: string[] = []
    const result = await fetchVavModels({
      endpoint: 'https://api.deepseek.com/anthropic',
      apiKey: 'sk-bad',
      fetchFn: async (input) => {
        calls.push(String(input))
        return new Response('nope', { status: 401 })
      }
    })
    assert.deepEqual(result.models, [])
    assert.equal(result.error, 'HTTP 401')
    assert.deepEqual(calls, ['https://api.deepseek.com/v1/models'])
  })

  it('returns the HTTP status as an error without throwing', async () => {
    const result = await fetchVavModels({
      endpoint: 'https://api.openai.com',
      apiKey: 'sk-test',
      fetchFn: async () => new Response('nope', { status: 401 })
    })
    assert.deepEqual(result.models, [])
    assert.equal(result.error, 'HTTP 401')
  })

  it('skips the probe without an endpoint and reports the reason', async () => {
    const result = await fetchVavModels({ endpoint: '  ', fetchFn: async () => {
      throw new Error('should not fetch')
    } })
    assert.deepEqual(result.models, [])
    assert.equal(result.error, 'no endpoint')
  })
})

describe('baseUrlFor', () => {
  it('trims OpenAI method URLs back to /v1', () => {
    assert.equal(baseUrlFor('https://api.openai.com', 'openai'), 'https://api.openai.com/v1')
    assert.equal(
      baseUrlFor('https://api.openai.com/v1/chat/completions', 'openai'),
      'https://api.openai.com/v1'
    )
  })

  it('trims Anthropic method URLs back to the bare host', () => {
    assert.equal(baseUrlFor('https://api.anthropic.com', 'anthropic'), 'https://api.anthropic.com')
    assert.equal(
      baseUrlFor('https://api.anthropic.com/v1/messages', 'anthropic'),
      'https://api.anthropic.com'
    )
  })

  it('keeps or adds the version segment for Google', () => {
    assert.equal(
      baseUrlFor('https://generativelanguage.googleapis.com', 'google'),
      'https://generativelanguage.googleapis.com/v1beta'
    )
    assert.equal(
      baseUrlFor(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?key=x',
        'google'
      ),
      'https://generativelanguage.googleapis.com/v1beta'
    )
    assert.equal(
      baseUrlFor('https://generativelanguage.googleapis.com/v1alpha', 'google'),
      'https://generativelanguage.googleapis.com/v1alpha'
    )
  })

  it('agrees with detectProtocol on google endpoints', () => {
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta'
    assert.equal(detectProtocol(endpoint, ''), 'google')
    assert.equal(baseUrlFor(endpoint, 'google'), endpoint)
  })
})
