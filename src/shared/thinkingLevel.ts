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
