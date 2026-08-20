/**
 * Live model discovery for the VAV host.
 *
 * `PRESET_MODELS` + hand-typed customs age badly, and every protocol VAV
 * speaks already publishes a model-list route: OpenAI-compatible `/v1/models`,
 * Anthropic `/v1/models`, Google `/v1beta/models`. This probe hits whichever
 * one matches the configured endpoint so the picker can list what the provider
 * actually serves (with catalog context-window badges where pi-ai knows the id).
 *
 * Pure fetch logic — injectable `fetchFn` keeps it testable; callers own the
 * key and the cache (see listHostModels.ts).
 */
import type { ModelOption } from '@shared/types'
import { baseUrlFor, detectProtocol } from '../../shared/vavProtocol.ts'

const PROBE_TIMEOUT_MS = 10_000
const GOOGLE_PAGE_SIZE = 1000

export interface VavModelProbeResult {
  models: ModelOption[]
  error?: string
}

export interface VavModelProbeInput {
  endpoint: string
  apiKey?: string | null
  fetchFn?: typeof fetch
  timeoutMs?: number
}

/**
 * Obviously non-chat model families worth hiding from a chat picker even when
 * the provider lists them.
 */
const NON_CHAT_MODEL = /embedding|whisper|tts|dall-e|moderation|babbage|davinci|imagen|aqa|veo|imagen/i

export async function fetchVavModels(input: VavModelProbeInput): Promise<VavModelProbeResult> {
  const endpoint = input.endpoint.trim()
  if (!endpoint) return { models: [], error: 'no endpoint' }
  const apiKey = input.apiKey?.trim() || null
  const protocol = detectProtocol(endpoint, '')
  const base = baseUrlFor(endpoint, protocol)
  const doFetch = input.fetchFn ?? fetch

  let url: string
  const headers: Record<string, string> = {}
  if (protocol === 'google') {
    url = `${base}/models?pageSize=${GOOGLE_PAGE_SIZE}`
    if (apiKey) headers['x-goog-api-key'] = apiKey
  } else if (protocol === 'anthropic') {
    url = `${base}/v1/models?limit=1000`
    if (apiKey) {
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
    }
  } else {
    url = `${base}/models`
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
  }

  try {
    const response = await doFetch(url, {
      headers,
      signal: AbortSignal.timeout(input.timeoutMs ?? PROBE_TIMEOUT_MS)
    })
    if (!response.ok) {
      return { models: [], error: `HTTP ${response.status}` }
    }
    const body = (await response.json()) as Record<string, unknown>
    return { models: parseModelOptions(body, protocol) }
  } catch (err) {
    return { models: [], error: (err as Error).message || 'probe failed' }
  }
}

function parseModelOptions(
  body: Record<string, unknown>,
  protocol: 'anthropic' | 'openai' | 'google'
): ModelOption[] {
  const out: ModelOption[] = []
  const seen = new Set<string>()
  const push = (id: string, label?: string): void => {
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed.toLowerCase())) return
    if (NON_CHAT_MODEL.test(trimmed)) return
    seen.add(trimmed.toLowerCase())
    out.push({ id: trimmed, label: label?.trim() || trimmed })
  }

  const rows = Array.isArray(body.data) ? body.data : []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const rec = row as { id?: unknown; display_name?: unknown }
    // OpenAI lists bare ids; Anthropic also publishes display_name.
    if (typeof rec.id === 'string') {
      push(rec.id, typeof rec.display_name === 'string' ? rec.display_name : undefined)
    }
  }

  if (protocol === 'google' && Array.isArray(body.models)) {
    for (const row of body.models) {
      if (!row || typeof row !== 'object') continue
      const rec = row as {
        name?: unknown
        displayName?: unknown
        supportedGenerationMethods?: unknown
      }
      if (typeof rec.name !== 'string' || !rec.name.startsWith('models/')) continue
      const methods: unknown[] = Array.isArray(rec.supportedGenerationMethods)
        ? rec.supportedGenerationMethods
        : []
      if (!methods.some((m) => m === 'generateContent')) continue
      push(
        rec.name.slice('models/'.length),
        typeof rec.displayName === 'string' ? rec.displayName : undefined
      )
    }
  }

  return out.sort((a, b) => a.id.localeCompare(b.id))
}
