/**
 * The LLM boundary, built on `@earendil-works/pi-ai`.
 *
 * vav configures one endpoint plus one key rather than a provider registry, so
 * this module skips pi's `Models` collection and drives the API modules
 * directly: it synthesises a `Model` descriptor from settings and dispatches to
 * the Anthropic, OpenAI, or Google implementation. Model metadata (context
 * window, output cap, reasoning support, input modalities, thinking-level
 * mapping) comes from pi's generated catalogs via `./modelMeta`, falling back
 * to vav's regex heuristics for unknown ids. What pi buys us over the
 * hand-rolled SSE reader that used to live here is the part that was actually
 * hard — token accounting, retries, provider quirks, and above all a stream
 * protocol where every partial event is addressed by `contentIndex`, so text
 * and tool calls keep the order the model emitted them in.
 */
import type { Api, Context, Model, SimpleStreamOptions } from '@earendil-works/pi-ai'
import type { AssistantMessageEventStream } from '@earendil-works/pi-ai'
import { streamSimple as anthropicMessages } from '@earendil-works/pi-ai/api/anthropic-messages'
import { streamSimple as openaiCompletions } from '@earendil-works/pi-ai/api/openai-completions'
import { streamSimple as googleGenerativeAi } from '@earendil-works/pi-ai/api/google-generative-ai'
import type { AppSettings } from '@shared/types'
import {
  DEEPSEEK_THINKING_LEVEL_MAP,
  deepSeekEffort,
  isDeepSeekModel,
  parseThinkingLevel
} from '@shared/thinkingLevel'
import { baseUrlFor, detectProtocol, type VavProtocol } from '@shared/vavProtocol'
import {
  contextWindowFor,
  maxTokensFor,
  modelAcceptsImage,
  modelSupportsThinking,
  thinkingLevelMapFor
} from './modelMeta'

export type Protocol = VavProtocol
export { baseUrlFor, detectProtocol }

export function buildModel(
  settings: AppSettings,
  modelId: string,
  contextWindow?: number
): Model<Api> {
  const protocol = detectProtocol(settings.apiEndpoint, modelId)
  const deepseek = isDeepSeekModel(modelId) || /deepseek/i.test(settings.apiEndpoint)
  const catalogMap = thinkingLevelMapFor(modelId)
  return {
    id: modelId,
    name: modelId,
    api:
      protocol === 'anthropic'
        ? 'anthropic-messages'
        : protocol === 'google'
          ? 'google-generative-ai'
          : 'openai-completions',
    provider: 'vav',
    baseUrl: baseUrlFor(settings.apiEndpoint, protocol),
    reasoning: modelSupportsThinking(modelId),
    input: modelAcceptsImage(modelId) ? (['text', 'image'] as const) : (['text'] as const),
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
      : catalogMap
        ? { thinkingLevelMap: { ...catalogMap } }
        : {}),
    // vav bills nothing; the conversation meter counts tokens, not dollars.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: contextWindow ?? contextWindowFor(modelId),
    maxTokens: maxTokensFor(modelId)
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
  const stream =
    model.api === 'anthropic-messages'
      ? anthropicMessages
      : model.api === 'google-generative-ai'
        ? googleGenerativeAi
        : openaiCompletions
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
    model as Model<'anthropic-messages'> &
      Model<'openai-completions'> &
      Model<'google-generative-ai'>,
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

