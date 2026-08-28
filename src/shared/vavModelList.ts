import { inferModalitiesFromId } from './modelModalities.ts'

/** Product default for new VAV sessions. The picker catalogue is live `/models`. */
export const VAV_DEFAULT_MODEL_ID = 'deepseek-v4-flash-vision-exp'

/** Older product defaults that should follow {@link VAV_DEFAULT_MODEL_ID}. */
export const VAV_LEGACY_DEFAULT_MODELS = ['deepseek-chat', 'deepseek-v4-pro'] as const

const LABELS: Record<string, string> = {
  'deepseek-v4-flash-vision-exp': 'DeepSeek V4 Flash Vision Exp',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-chat': 'DeepSeek Chat',
  'deepseek-reasoner': 'DeepSeek Reasoner',
  'glm-4': 'GLM-4',
  'glm-4-plus': 'GLM-4 Plus',
  'glm-4-air': 'GLM-4 Air',
  'glm-4-flash': 'GLM-4 Flash',
  'glm-4v': 'GLM-4V',
  'moonshot-v1-8k': 'Kimi 8k',
  'moonshot-v1-32k': 'Kimi 32k',
  'moonshot-v1-128k': 'Kimi 128k'
}

export function isOfficialDeepSeekEndpoint(endpoint: string): boolean {
  return /(?:^|[/.])deepseek\.(?:com|ai)(?:[:/]|$)/i.test(endpoint)
}

export function isNativeDeepSeekModelId(id: string): boolean {
  return /^deepseek[-_]/i.test(id) && !id.includes('/')
}

export function nativeDeepSeekModels<T extends { id: string }>(models: T[]): T[] {
  return models.filter((model) => isNativeDeepSeekModelId(model.id))
}

export function deepseekOfficialModels(): Array<{ id: string; label: string }> {
  return Object.entries(LABELS).map(([id, label]) => ({
    id,
    label,
    ...inferModalitiesFromId(id)
  }))
}

export function prettyVavModelLabel(id: string): string {
  return LABELS[id] ?? id
}

/** One-row seed so the picker has an id before `/models` returns. */
export function vavFallbackModels(
  defaultModel?: string | null,
  vendorId?: string | null
): Array<{ id: string; label: string }> {
  if (defaultModel?.trim()) {
    return [{ id: defaultModel, label: prettyVavModelLabel(defaultModel), ...inferModalitiesFromId(defaultModel) }]
  }

  const id = ((): string => {
    switch (vendorId) {
      case 'openai':
        return 'gpt-4o'
      case 'anthropic':
        return 'claude-3-5-sonnet-20241022'
      case 'google':
        return 'gemini-1.5-pro'
      case 'deepseek':
        return VAV_DEFAULT_MODEL_ID
      case 'xai':
        return 'grok-beta'
      case 'kimi':
        return 'moonshot-v1-8k'
      case 'bigmodel':
        return 'glm-4'
      default:
        return VAV_DEFAULT_MODEL_ID
    }
  })()

  return [{ id, label: prettyVavModelLabel(id), ...inferModalitiesFromId(id) }]
}

/** Keep a valid current id; otherwise prefer the product default, else first. */
export function pickVavDefaultModel(
  current: string | null | undefined,
  liveIds: string[]
): string {
  const cur = current?.trim() ?? ''
  if (cur && liveIds.includes(cur)) return cur
  if (liveIds.includes(VAV_DEFAULT_MODEL_ID)) return VAV_DEFAULT_MODEL_ID
  return liveIds[0] ?? (cur || VAV_DEFAULT_MODEL_ID)
}

/** Pin the preferred id first; the rest stay alphabetical. */
export function orderVavModels<T extends { id: string }>(
  models: T[],
  preferredId?: string | null
): T[] {
  const preferred = (preferredId?.trim() || VAV_DEFAULT_MODEL_ID).toLowerCase()
  return [...models].sort((a, b) => {
    const aPref = a.id.toLowerCase() === preferred
    const bPref = b.id.toLowerCase() === preferred
    if (aPref !== bPref) return aPref ? -1 : 1
    return a.id.localeCompare(b.id)
  })
}
