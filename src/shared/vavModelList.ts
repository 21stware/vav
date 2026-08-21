import { inferModalitiesFromId } from './modelModalities.ts'

/** Product default for new VAV sessions. The picker catalogue is live `/models`. */
export const VAV_DEFAULT_MODEL_ID = 'deepseek-v4-flash-vision-exp'

/** Older product defaults that should follow {@link VAV_DEFAULT_MODEL_ID}. */
export const VAV_LEGACY_DEFAULT_MODELS = ['deepseek-chat', 'deepseek-v4-pro'] as const

const LABELS: Record<string, string> = {
  'deepseek-v4-flash-vision-exp': 'DeepSeek V4 Flash Vision Exp',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v4-flash': 'DeepSeek V4 Flash'
}

export function prettyVavModelLabel(id: string): string {
  return LABELS[id] ?? id
}

/** One-row seed so the picker has an id before `/models` returns. */
export function vavFallbackModels(
  defaultModel?: string | null
): Array<{ id: string; label: string }> {
  const id = defaultModel?.trim() || VAV_DEFAULT_MODEL_ID
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
