export type VavProtocol = 'anthropic' | 'openai'

function isAnthropicMessagesUrl(endpoint: string): boolean {
  const value = endpoint.toLowerCase()
  return /\/anthropic(\/|$)/.test(value) || value.includes('/v1/messages')
}

/** Anthropic-native unless the endpoint (or model id) points at an OpenAI-shaped API. */
export function detectProtocol(endpoint: string, modelId = ''): VavProtocol {
  const value = endpoint.toLowerCase()
  const model = modelId.toLowerCase()
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
