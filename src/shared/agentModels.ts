import type { CliHostKind, ModelOption, RecentAgentModelEntry } from './types'
import { isStructuredCliHost, PRESET_MODELS } from './types'

/** Max entries kept in Settings `recentAgentModels` (MRU queue). */
export const RECENT_AGENT_MODELS_MAX = 10

/** How many recents sit on the picker menu's first level. */
export const RECENT_AGENT_MODELS_PINNED = 3

/**
 * Client-side helpers for agent → model selection.
 *
 * VAV models come from {@link PRESET_MODELS} + settings.customModels.
 * CLI host models are listed live via `agents.listModels` (main process
 * probes each CLI). This file only holds sync fallbacks used before / without
 * a live probe — never a guessed catalogue of non-existent model ids.
 */

export type ChatHostId = CliHostKind | 'vav'

/** Empty id = CLI's own default (omit `--model`). */
export const CLI_DEFAULT_MODEL: ModelOption = { id: '', label: 'Default' }

/** Documented Claude Code `--model` aliases from `claude --help`. */
export const CLAUDE_MODEL_ALIASES: ModelOption[] = [
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'haiku', label: 'Haiku' },
  { id: 'fable', label: 'Fable' }
]

export function chatHostId(cliHost: CliHostKind | null | undefined): ChatHostId {
  return cliHost ?? 'vav'
}

/** Sync fallback while live list is loading / unavailable. */
export function modelsForChatHost(
  host: CliHostKind | null | undefined,
  customModels: string[] = []
): ModelOption[] {
  const id = chatHostId(host)
  if (id === 'vav') {
    const presets = PRESET_MODELS
    const presetIds = new Set(presets.map((m) => m.id))
    const custom = customModels
      .filter((m) => m.trim() && !presetIds.has(m))
      .map((m) => ({ id: m, label: m }))
    return custom.length ? [...presets, ...custom] : [...presets]
  }
  if (id === 'claude') return [...CLAUDE_MODEL_ALIASES]
  return [CLI_DEFAULT_MODEL]
}

export function resolveModelForChatHost(
  host: CliHostKind | null | undefined,
  currentModel: string | null | undefined,
  options?: {
    customModels?: string[]
    vavDefaultModel?: string | null
    /** Prefer this catalogue when live list already loaded. */
    catalogue?: ModelOption[] | null
  }
): string {
  const list =
    options?.catalogue && options.catalogue.length > 0
      ? options.catalogue
      : modelsForChatHost(host, options?.customModels)
  const current = currentModel?.trim() ?? ''
  // Empty string is a valid "CLI default" choice.
  if (list.some((m) => m.id === current)) return current
  if (chatHostId(host) === 'vav') {
    const vavDefault = options?.vavDefaultModel?.trim()
    if (vavDefault && list.some((m) => m.id === vavDefault)) return vavDefault
  }
  return list[0]?.id ?? ''
}

export function labelForChatModel(
  host: CliHostKind | null | undefined,
  modelId: string,
  customModels: string[] = [],
  catalogue?: ModelOption[] | null
): string {
  if (!modelId) return CLI_DEFAULT_MODEL.label
  const list =
    catalogue && catalogue.length > 0 ? catalogue : modelsForChatHost(host, customModels)
  const hit = list.find((m) => m.id === modelId)
  if (hit) return hit.label
  return PRESET_MODELS.find((m) => m.id === modelId)?.label ?? modelId
}

/** Host key used in {@link AppSettings.disabledAgentModels}. */
export function agentModelHostKey(host: CliHostKind | null | undefined): string {
  return chatHostId(host)
}

/** Drop models the user disabled in Settings. */
export function filterEnabledModels(
  host: CliHostKind | null | undefined,
  models: ModelOption[],
  disabledAgentModels: Record<string, string[]> | null | undefined
): ModelOption[] {
  const disabled = new Set(disabledAgentModels?.[agentModelHostKey(host)] ?? [])
  if (disabled.size === 0) return models
  const kept = models.filter((m) => !disabled.has(m.id))
  // Never leave a host with zero choices — keep Default / first.
  return kept.length > 0 ? kept : models.slice(0, 1)
}

export function isAgentModelEnabled(
  host: CliHostKind | null | undefined,
  modelId: string,
  disabledAgentModels: Record<string, string[]> | null | undefined
): boolean {
  const disabled = disabledAgentModels?.[agentModelHostKey(host)] ?? []
  return !disabled.includes(modelId)
}

/** Settings key ↔ picker host (`null` = VAV). */
export function hostIdForChatHost(host: CliHostKind | null | undefined): string {
  return chatHostId(host)
}

export function chatHostFromHostId(hostId: string): CliHostKind | null {
  if (!hostId || hostId === 'vav') return null
  return isStructuredCliHost(hostId) ? hostId : null
}

export function recentAgentModelKey(entry: RecentAgentModelEntry): string {
  return `${entry.hostId}\0${entry.model}`
}

/** Push to front, dedupe, cap — returns a new array (no mutation). */
export function pushRecentAgentModel(
  list: RecentAgentModelEntry[] | null | undefined,
  entry: RecentAgentModelEntry,
  max = RECENT_AGENT_MODELS_MAX
): RecentAgentModelEntry[] {
  const hostId = entry.hostId.trim() || 'vav'
  const model = typeof entry.model === 'string' ? entry.model : ''
  const next: RecentAgentModelEntry = { hostId, model }
  const key = recentAgentModelKey(next)
  return [next, ...(list ?? []).filter((e) => recentAgentModelKey(e) !== key)].slice(0, max)
}
