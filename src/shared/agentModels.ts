import type { CliHostKind, ModelOption, RecentAgentModelEntry } from './types.ts'
import { isStructuredCliHost, PRESET_MODELS } from './types.ts'
import { displayNameForCliHost } from './cliHost.ts'
import { isLlmVendorId } from './llmVendors.ts'
import { shortenModelLabel } from './shortenModelLabel.ts'
import { prettyVavModelLabel, vavFallbackModels } from './vavModelList.ts'

export {
  VAV_DEFAULT_MODEL_ID,
  VAV_LEGACY_DEFAULT_MODELS,
  prettyVavModelLabel,
  vavFallbackModels,
  deepseekOfficialModels,
  isOfficialDeepSeekEndpoint,
  isNativeDeepSeekModelId,
  nativeDeepSeekModels,
  pickVavDefaultModel,
  orderVavModels
} from './vavModelList.ts'

/** Max entries kept in Settings `recentAgentModels` (MRU queue). */
export const RECENT_AGENT_MODELS_MAX = 10

/** How many recents sit on the picker menu's first level. */
export const RECENT_AGENT_MODELS_PINNED = 3

/**
 * Client-side helpers for agent → model selection.
 *
 * VAV models come from a live `/models` probe (API key + endpoint). This file
 * only holds sync fallbacks used before / without that probe — never a
 * shipped catalogue. CLI host models are listed live via `agents.listModels`.
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
  _customModels: string[] = [],
  vavDefaultModel?: string | null
): ModelOption[] {
  const id = chatHostId(host)
  if (id === 'vav') return vavFallbackModels(vavDefaultModel)
  if (id === 'claude') return [...CLAUDE_MODEL_ALIASES]
  return [CLI_DEFAULT_MODEL]
}

/** Stored default model for this chat host (`""` = CLI's own Default). */
export function defaultModelForChatHost(
  host: CliHostKind | null | undefined,
  settings: {
    defaultModel?: string | null
    defaultAgentModels?: Record<string, string> | null
  }
): string | undefined {
  const key = chatHostId(host)
  const perHost = settings.defaultAgentModels?.[key]
  if (perHost !== undefined) return perHost
  if (key === 'vav') return settings.defaultModel ?? undefined
  return undefined
}

export function resolveModelForChatHost(
  host: CliHostKind | null | undefined,
  currentModel: string | null | undefined,
  options?: {
    customModels?: string[]
    vavDefaultModel?: string | null
    /** Per-host default (CLI may be `""`). Tried after the current id. */
    hostDefaultModel?: string | null
    /** Prefer this catalogue when live list already loaded. */
    catalogue?: ModelOption[] | null
  }
): string {
  const hasCatalogue = !!(options?.catalogue && options.catalogue.length > 0)
  const list = hasCatalogue
    ? options!.catalogue!
    : modelsForChatHost(host, options?.customModels, options?.vavDefaultModel)
  const current = currentModel ?? ''
  // Empty string is a valid "CLI default" choice.
  if (list.some((m) => m.id === current)) return current
  // Keep a stored / requested id. The seed fallback for CLI hosts is a single
  // "Default" row (`id: ""`) — snapping a real pick (Cursor Grok, …) onto that
  // row made the picker look like the switch never stuck, and coerce wrote it.
  if (current) return current
  const hostDefault = options?.hostDefaultModel
  if (hostDefault !== undefined && hostDefault !== null) {
    if (!hasCatalogue || list.some((m) => m.id === hostDefault)) return hostDefault
  }
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
    catalogue && catalogue.length > 0
      ? catalogue
      : modelsForChatHost(host, customModels)
  const hit = list.find((m) => m.id === modelId)
  const raw =
    hit?.label ?? PRESET_MODELS.find((m) => m.id === modelId)?.label ?? prettyVavModelLabel(modelId)
  return host ? shortenModelLabel(raw, displayNameForCliHost(host)) : raw
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

/** Settings key ↔ picker host (`null` = VAV). Vendor ids also map to VAV. */
export function hostIdForChatHost(
  host: CliHostKind | null | undefined,
  vendorId?: string | null
): string {
  if (host) return chatHostId(host)
  return vendorId && isLlmVendorId(vendorId) ? vendorId : 'vav'
}

export function chatHostFromHostId(hostId: string): CliHostKind | null {
  if (!hostId || hostId === 'vav' || isLlmVendorId(hostId)) return null
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
