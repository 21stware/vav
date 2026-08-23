/**
 * Live model discovery for the VAV host.
 *
 * Every protocol VAV speaks already publishes a model-list route:
 * OpenAI-compatible `/v1/models`, Anthropic `/v1/models`, Google
 * `/v1beta/models`. An `/anthropic` Messages mount (DeepSeek and similar)
 * usually has no `/v1/models` — those list at the OpenAI root, so the probe
 * tries that first and only then the Anthropic path.
 *
 * Pure fetch logic — injectable `fetchFn` keeps it testable; callers own the
 * key and the cache (see listHostModels.ts).
 */
import type { ModelOption } from '@shared/types'
import { isOfficialDeepSeekEndpoint, nativeDeepSeekModels } from '../../shared/vavModelList.ts'
import { parseLiveModalities } from '../../shared/modelModalities.ts'
import { baseUrlFor, detectProtocol } from '../../shared/vavProtocol.ts'

const PROBE_TIMEOUT_MS = 10_000
const GOOGLE_PAGE_SIZE = 1000

/** Retry the next candidate only when this route itself is missing. */
const MISSING_ROUTE = new Set([404, 405])

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

type ProbeProtocol = 'anthropic' | 'openai' | 'google'

export interface VavModelProbeTarget {
  url: string
  protocol: ProbeProtocol
}

/**
 * Obviously non-chat model families worth hiding from a chat picker even when
 * the provider lists them.
 */
const NON_CHAT_MODEL = /embedding|whisper|tts|dall-e|moderation|babbage|davinci|imagen|aqa|veo|imagen/i

/**
 * DeepSeek (and similar) serve Messages at `/anthropic` but list models on the
 * OpenAI root. Try that root first so the picker does not 404 on a mount that
 * never published `/v1/models`.
 */
export function vavModelProbeTargets(endpoint: string): VavModelProbeTarget[] {
  const protocol = detectProtocol(endpoint, '')
  const base = baseUrlFor(endpoint, protocol)
  if (protocol === 'google') {
    return [{ url: `${base}/models?pageSize=${GOOGLE_PAGE_SIZE}`, protocol: 'google' }]
  }
  if (protocol === 'openai') {
    return [{ url: `${base}/models`, protocol: 'openai' }]
  }
  const anthropic: VavModelProbeTarget = {
    url: `${base}/v1/models?limit=1000`,
    protocol: 'anthropic'
  }
  const openaiOrigin = base.replace(/\/anthropic$/i, '')
  if (openaiOrigin === base) return [anthropic]
  return [
    { url: `${baseUrlFor(openaiOrigin, 'openai')}/models`, protocol: 'openai' },
    anthropic
  ]
}

function headersFor(protocol: ProbeProtocol, apiKey: string | null): Record<string, string> {
  const headers: Record<string, string> = {}
  if (!apiKey) return headers
  if (protocol === 'google') headers['x-goog-api-key'] = apiKey
  else if (protocol === 'anthropic') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers.authorization = `Bearer ${apiKey}`
  }
  return headers
}

export async function fetchVavModels(input: VavModelProbeInput): Promise<VavModelProbeResult> {
  const endpoint = input.endpoint.trim()
  if (!endpoint) return { models: [], error: 'no endpoint' }
  const apiKey = input.apiKey?.trim() || null
  const doFetch = input.fetchFn ?? fetch
  const targets = vavModelProbeTargets(endpoint)

  let lastError = 'probe failed'
  for (const target of targets) {
    try {
      const response = await doFetch(target.url, {
        headers: headersFor(target.protocol, apiKey),
        signal: AbortSignal.timeout(input.timeoutMs ?? PROBE_TIMEOUT_MS)
      })
      if (response.ok) {
        const body = (await response.json()) as Record<string, unknown>
        return { models: filterModelsForEndpoint(endpoint, parseModelOptions(body, target.protocol)) }
      }
      lastError = `HTTP ${response.status}`
      if (!MISSING_ROUTE.has(response.status)) {
        return { models: [], error: lastError }
      }
    } catch (err) {
      return { models: [], error: (err as Error).message || 'probe failed' }
    }
  }
  return { models: [], error: lastError }
}

export { isOfficialDeepSeekEndpoint }

/** Official DeepSeek hosts should never keep OpenRouter-style `vendor/model` rows. */
export function filterModelsForEndpoint(endpoint: string, models: ModelOption[]): ModelOption[] {
  if (!isOfficialDeepSeekEndpoint(endpoint)) return models
  return nativeDeepSeekModels(models)
}

export function isVavAuthError(error: string): boolean {
  return /\b401\b|\b403\b|unauthorized|invalid[_ ]?api[_ ]?key|authentication/i.test(error)
}

export interface ValidateVavApiKeyResult {
  ok: boolean
  authFailed: boolean
  modelCount: number
  error?: string
}

/**
 * Connection test for a VAV key profile: list models on this endpoint.
 * Do not send a chat with the app default model — that model often does not
 * exist on this provider, and a 400 is not an invalid key.
 */
export async function validateVavApiKey(
  endpoint: string,
  apiKey: string,
  options?: { fetchFn?: typeof fetch; timeoutMs?: number }
): Promise<ValidateVavApiKeyResult> {
  const probe = await fetchVavModels({
    endpoint,
    apiKey,
    fetchFn: options?.fetchFn,
    timeoutMs: options?.timeoutMs
  })
  if (!probe.error) {
    return { ok: true, authFailed: false, modelCount: probe.models.length }
  }
  return {
    ok: false,
    authFailed: isVavAuthError(probe.error),
    modelCount: 0,
    error: probe.error
  }
}

function parseModelOptions(
  body: Record<string, unknown>,
  protocol: 'anthropic' | 'openai' | 'google'
): ModelOption[] {
  const out: ModelOption[] = []
  const seen = new Set<string>()
  const push = (id: string, label?: string, extra?: Pick<ModelOption, 'input' | 'output'>): void => {
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed.toLowerCase())) return
    if (NON_CHAT_MODEL.test(trimmed)) return
    seen.add(trimmed.toLowerCase())
    out.push({ id: trimmed, label: label?.trim() || trimmed, ...extra })
  }

  const rows = Array.isArray(body.data) ? body.data : []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const rec = row as { id?: unknown; display_name?: unknown }
    // OpenAI lists bare ids; Anthropic also publishes display_name.
    if (typeof rec.id === 'string') {
      push(
        rec.id,
        typeof rec.display_name === 'string' ? rec.display_name : undefined,
        parseLiveModalities(rec as Record<string, unknown>)
      )
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
