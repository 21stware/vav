/**
 * The LLM boundary, built on `@earendil-works/pi-ai`.
 *
 * vav configures one endpoint plus one key rather than a provider registry, so
 * this module skips pi's `Models` collection and drives the API modules
 * directly: it synthesises a `Model` descriptor from settings and dispatches to
 * the Anthropic or OpenAI implementation. What pi buys us over the hand-rolled
 * SSE reader that used to live here is the part that was actually hard — token
 * accounting, retries, provider quirks, and above all a stream protocol where
 * every partial event is addressed by `contentIndex`, so text and tool calls
 * keep the order the model emitted them in.
 */
import type { Api, Context, Model, SimpleStreamOptions } from '@earendil-works/pi-ai'
import type { AssistantMessageEventStream } from '@earendil-works/pi-ai'
import { streamSimple as anthropicMessages } from '@earendil-works/pi-ai/api/anthropic-messages'
import { streamSimple as openaiCompletions } from '@earendil-works/pi-ai/api/openai-completions'
import type { AppSettings } from '@shared/types'
import {
  DEEPSEEK_THINKING_LEVEL_MAP,
  deepSeekEffort,
  isDeepSeekModel,
  parseThinkingLevel,
  vavModelSupportsThinking
} from '@shared/thinkingLevel'
import { detectProtocol, type VavProtocol } from '@shared/vavProtocol'
import { resolveMaxTokens } from '@shared/tokenUsage'

export type Protocol = VavProtocol
export { detectProtocol }

/**
 * The SDKs append their own route, so a pasted full URL has to be trimmed back
 * to the base the client expects: bare host for Anthropic, `/v1` for OpenAI.
 */
function baseUrlFor(endpoint: string, protocol: Protocol): string {
  let base = endpoint.trim().replace(/\/+$/, '')
  base = base.replace(/\/v1\/messages$/, '').replace(/\/(v1\/)?chat\/completions$/, '')
  if (protocol === 'anthropic') return base.replace(/\/v1$/, '')
  return /\/v1$/.test(base) ? base : `${base}/v1`
}

export function buildModel(
  settings: AppSettings,
  modelId: string,
  contextWindow: number
): Model<Api> {
  const protocol = detectProtocol(settings.apiEndpoint, modelId)
  const deepseek = isDeepSeekModel(modelId) || /deepseek/i.test(settings.apiEndpoint)
  return {
    id: modelId,
    name: modelId,
    api: protocol === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
    provider: 'vav',
    baseUrl: baseUrlFor(settings.apiEndpoint, protocol),
    reasoning: vavModelSupportsThinking(modelId),
    ...(deepseek
      ? {
          thinkingLevelMap: { ...DEEPSEEK_THINKING_LEVEL_MAP },
          ...(protocol === 'openai'
            ? {
                compat: {
                  thinkingFormat: 'deepseek' as const,
                  supportsReasoningEffort: true
                }
              }
            : {})
        }
      : {}),
    input: ['text'],
    // vav bills nothing; the conversation meter counts tokens, not dollars.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: resolveMaxTokens(modelId)
  }
}

/**
 * DeepSeek's OpenAI path wants `thinking.type` + `reasoning_effort`.
 * The Anthropic path wants `reasoning.effort` / `output_config.effort`.
 * pi-ai's Claude budget-thinking is neither; rewrite the payload.
 */
function applyDeepSeekThinking(
  params: Record<string, unknown>,
  model: Model<Api>,
  options: SimpleStreamOptions
): Record<string, unknown> {
  if (!isDeepSeekModel(model.id)) return params
  const effort = options.reasoning
    ? deepSeekEffort(parseThinkingLevel(options.reasoning))
    : null
  if (model.api === 'anthropic-messages') {
    const next = { ...params }
    delete next.thinking
    if (!effort) {
      next.reasoning = { effort: 'none' }
    } else {
      next.reasoning = { effort }
      next.output_config = { effort }
    }
    return next
  }
  if (!effort) {
    return { ...params, thinking: { type: 'disabled' } }
  }
  return {
    ...params,
    thinking: { type: 'enabled' },
    reasoning_effort: effort
  }
}

export function streamWith(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions
): AssistantMessageEventStream {
  const stream = model.api === 'anthropic-messages' ? anthropicMessages : openaiCompletions
  const patched: SimpleStreamOptions = {
    ...options,
    onPayload: (params, payloadModel) => {
      const next = applyDeepSeekThinking(
        params as Record<string, unknown>,
        payloadModel,
        options
      )
      return options.onPayload
        ? options.onPayload(next, payloadModel)
        : next
    }
  }
  return stream(
    model as Model<'anthropic-messages'> & Model<'openai-completions'>,
    context,
    patched
  )
}

/** Turns a provider error into something worth showing in the banner. */
export function describeError(message: string): string {
  const text = message.trim()
  if (!text) return '请求失败'
  if (/\b401\b|invalid[_ ]?api[_ ]?key|unauthorized/i.test(text)) {
    // The only failure whose cause is usually on the settings screen rather
    // than at the provider, so it is worth naming what to check. Settings used
    // to say this in a standing "提示" box that was there before anything had
    // gone wrong; it belongs here, where it is a diagnosis instead of trivia.
    return `401 密钥被拒绝：检查密钥有没有填错、有没有保存，以及端点是否匹配该提供商 — ${text}`
  }
  if (/\b429\b|rate[_ ]?limit/i.test(text)) return `429 速率限制 — ${text}`
  return `请求失败：${text}`
}

/** One tiny call, used by the Settings "验证" button. */
export async function validateApiKey(
  endpoint: string,
  apiKey: string,
  model: string
): Promise<{ ok: boolean; message: string }> {
  const settings = { apiEndpoint: endpoint, maxTokens: 16 } as AppSettings
  try {
    const result = await streamWith(
      buildModel(settings, model, 200_000),
      { messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }] },
      { apiKey, maxTokens: 16, signal: AbortSignal.timeout(20_000) }
    ).result()
    if (result.stopReason === 'error' || result.stopReason === 'aborted') {
      return { ok: false, message: describeError(result.errorMessage ?? '未知错误') }
    }
    return { ok: true, message: '验证成功 · 模型可达' }
  } catch (err) {
    return { ok: false, message: describeError((err as Error).message) }
  }
}
