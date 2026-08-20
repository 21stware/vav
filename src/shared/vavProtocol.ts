export type VavProtocol = 'anthropic' | 'openai' | 'google'

function isAnthropicMessagesUrl(endpoint: string): boolean {
  const value = endpoint.toLowerCase()
  return /\/anthropic(\/|$)/.test(value) || value.includes('/v1/messages')
}

/** Google AI Studio / Gemini API mount — the one Google endpoint that takes a plain API key. */
function isGoogleGenerativeLanguageUrl(endpoint: string): boolean {
  return /generativelanguage\.googleapis\.com/.test(endpoint.toLowerCase())
}

/** Anthropic-native unless the endpoint (or model id) points at an OpenAI-shaped API. */
export function detectProtocol(endpoint: string, modelId = ''): VavProtocol {
  const value = endpoint.toLowerCase()
  const model = modelId.toLowerCase()
  // Google's native protocol is only driven by the endpoint: gateways proxying
  // gemini models over OpenAI-compat stay on the OpenAI path.
  if (isGoogleGenerativeLanguageUrl(value)) return 'google'
  // DeepSeek's native API is OpenAI Chat Completions. Only use Anthropic when
  // the URL is explicitly the Messages mount (`/anthropic`, `/v1/messages`).
  // A bare `includes('anthropic')` would pin api.anthropic.com + deepseek-*
  // (and any gateway whose host mentions Anthropic) to Claude thinking params,
  // which DeepSeek ignores — thinking never starts.
  if (/deepseek/i.test(model) || value.includes('deepseek')) {
    return isAnthropicMessagesUrl(value) ? 'anthropic' : 'openai'
  }
  if (value.includes('anthropic')) return 'anthropic'
  if (
    value.includes('/chat/completions') ||
    value.includes('openai') ||
    value.includes('openrouter') ||
    model.startsWith('gpt-') ||
    /^o[134]/.test(model)
  ) {
    return 'openai'
  }
  return 'anthropic'
}

/**
 * The SDKs append their own route, so a pasted full URL has to be trimmed back
 * to the base the client expects: bare host for Anthropic, `/v1` for OpenAI,
 * and a versioned root (`/v1beta`) for Google — the Google SDK skips its own
 * apiVersion when a baseUrl is set, so the version segment must ride along.
 */
export function baseUrlFor(endpoint: string, protocol: VavProtocol): string {
  let base = endpoint.trim().replace(/\/+$/, '')
  if (protocol === 'google') {
    // Google "get code" snippets paste the full method URL, key included.
    base = base.replace(/\?.*$/, '').replace(/#.*$/, '')
    base = base.replace(/\/models\/.*$/i, '').replace(/:(?:stream)?generatecontent.*$/i, '')
    return /\/v1[a-z]*$/i.test(base) ? base : `${base}/v1beta`
  }
  base = base.replace(/\/v1\/messages$/, '').replace(/\/(v1\/)?chat\/completions$/, '')
  if (protocol === 'anthropic') return base.replace(/\/v1$/, '')
  return /\/v1$/.test(base) ? base : `${base}/v1`
}
