import {
  cursorFamilyAllowsThinkingOverlay,
  cursorModelFamilyId
} from './cursorModel.ts'
import type { ThinkingLevel } from './types'

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'off',
  'low',
  'medium',
  'high',
  'max'
] as const

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'high'

const LEVEL_SET = new Set<string>(THINKING_LEVELS)

/** Coerce persisted / user input to a known level. Invalid → High. */
export function parseThinkingLevel(value: unknown): ThinkingLevel {
  if (typeof value === 'string' && LEVEL_SET.has(value)) return value as ThinkingLevel
  return DEFAULT_THINKING_LEVEL
}

/**
 * pi-ai `reasoning` option. `off` omits the field so the provider disables
 * thinking instead of sending a bogus effort.
 */
export function toPiReasoning(
  level: ThinkingLevel
): Exclude<ThinkingLevel, 'off'> | undefined {
  return level === 'off' ? undefined : level
}

/**
 * Models we know cannot take a thinking / reasoning-effort parameter.
 * Unknown custom ids stay enabled — Off is always a valid request.
 */
/** Thinking chip: VAV models, plus Cursor (family id, not effort/fast variants). */
export function sessionShowsThinking(
  cliHost: string | null | undefined,
  modelId: string | null | undefined
): boolean {
  if (cliHost && cliHost !== 'cursor') return false
  const raw = (modelId ?? '').trim()
  if (!raw) return false
  const id = cliHost === 'cursor' ? cursorModelFamilyId(raw) : raw
  if (cliHost === 'cursor' && /^(auto|default)$/i.test(id)) return false
  return vavModelSupportsThinking(id)
}

/** Fast chip: Cursor ACP only. */
export function sessionShowsFast(cliHost: string | null | undefined): boolean {
  return cliHost === 'cursor'
}

/** Thinking menu: only levels this Cursor model actually accepts. */
export function thinkingLevelsForSession(opts: {
  cliHost?: string | null
  modelId?: string | null
  acpThinkingLevels?: readonly ThinkingLevel[] | null
  catalogueDefault?: ThinkingLevel | null
}): ThinkingLevel[] {
  if (opts.acpThinkingLevels && opts.acpThinkingLevels.length > 0) {
    return orderThinkingLevels(opts.acpThinkingLevels)
  }
  if (opts.cliHost && opts.cliHost !== 'cursor') return [...THINKING_LEVELS]
  const family = cursorModelFamilyId(opts.modelId ?? '')
  if (
    opts.cliHost === 'cursor' &&
    family &&
    !cursorFamilyAllowsThinkingOverlay(family) &&
    opts.catalogueDefault
  ) {
    return [opts.catalogueDefault]
  }
  return [...THINKING_LEVELS]
}

export function clampThinkingLevel(
  level: ThinkingLevel,
  allowed: readonly ThinkingLevel[]
): ThinkingLevel {
  if (allowed.length === 0 || allowed.includes(level)) return level
  if (allowed.includes('max')) return 'max'
  return allowed[allowed.length - 1] ?? DEFAULT_THINKING_LEVEL
}

function orderThinkingLevels(levels: readonly ThinkingLevel[]): ThinkingLevel[] {
  return THINKING_LEVELS.filter((level) => levels.includes(level))
}

export function vavModelSupportsThinking(modelId: string): boolean {
  const id = modelId.trim().toLowerCase()
  if (!id) return false
  if (/^gpt-4o/.test(id)) return false
  if (id === 'gpt-4' || /^gpt-4-/.test(id)) return false
  if (/^gpt-3\.5/.test(id)) return false
  if (/claude-3(?:-5)?-haiku|claude-haiku-3/.test(id)) return false
  if (/claude-3(?:-5)?-sonnet|claude-3-opus/.test(id)) return false
  return true
}

export function isDeepSeekModel(modelId: string): boolean {
  return /deepseek/i.test(modelId)
}

/** DeepSeek V4 only has low / high / max; medium collapses to high. */
export const DEEPSEEK_THINKING_LEVEL_MAP = {
  minimal: 'low',
  low: 'low',
  medium: 'high',
  high: 'high',
  xhigh: 'max',
  max: 'max'
} as const

/** DeepSeek's accepted effort string, or null to disable thinking. */
export function deepSeekEffort(
  level: ThinkingLevel
): 'low' | 'high' | 'max' | null {
  if (level === 'off') return null
  return DEEPSEEK_THINKING_LEVEL_MAP[level]
}

/** Whole seconds for the settled thinking row. Sub-second bursts still read as 1. */
export function thinkingSeconds(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1
  return Math.max(1, Math.round(durationMs / 1000))
}
