import type { ModelOption, ThinkingLevel } from './types.ts'

/**
 * Cursor `--list-models` encodes effort / fast in the id
 * (`grok-4.6-low-fast`). VAV stores the family and applies those as
 * session-run chips.
 */

export function cursorModelFamilyId(id: string): string {
  const alias = parseCursorModelAlias(id.trim())
  if (alias.auto) return 'auto'
  return alias.family
}

export function isCursorPickerAlias(id: string): boolean {
  const trimmed = id.trim()
  if (!trimmed || trimmed.includes('[')) return false
  if (/^(auto|default)$/i.test(trimmed)) return false
  if (trimmed.startsWith('cursor-')) return true
  return (
    /-(?:thinking-)?(?:low|medium|high|xhigh|max)(?:-fast)?$/.test(trimmed) ||
    /-(?:fast)$/.test(trimmed)
  )
}

/** Grok / Claude / Gemini accept thinking overlays. Kimi / GPT lock to advertised. */
export function cursorFamilyAllowsThinkingOverlay(family: string): boolean {
  return /^(grok|claude|gemini)/i.test(family)
}

/** Collapse `--list-models` effort/fast variants onto one family row. */
export function collapseCursorListModels(models: ModelOption[]): ModelOption[] {
  const byFamily = new Map<string, ModelOption>()
  const levelsByFamily = new Map<string, Set<ThinkingLevel>>()
  const defaultByFamily = new Map<string, ThinkingLevel>()
  for (const model of models) {
    const alias = parseCursorModelAlias(model.id)
    const family = alias.auto ? 'auto' : alias.family
    const level = effortToThinkingLevel(alias.effort)
    if (level) {
      const set = levelsByFamily.get(family) ?? new Set<ThinkingLevel>()
      set.add(level)
      levelsByFamily.set(family, set)
      if (!/\b(Low|Medium|High|Max)\b/i.test(model.label)) {
        defaultByFamily.set(family, level)
      }
    }
    if (byFamily.has(family)) continue
    byFamily.set(family, {
      ...model,
      id: family,
      label: cleanCursorLabel(model.label, family)
    })
  }
  return [...byFamily.values()].map((model) => {
    const levels = [...(levelsByFamily.get(model.id) ?? [])]
    const defaultLevel =
      defaultByFamily.get(model.id) ??
      (levels.includes('max') ? 'max' : levels[levels.length - 1])
    return {
      ...model,
      ...(levels.length ? { thinkingLevels: levels } : {}),
      ...(defaultLevel ? { defaultThinkingLevel: defaultLevel } : {})
    }
  })
}

/** Read thinking / fast back from an ACP or leftover `--list-models` id. */
export function prefsFromCursorModelId(id: string): {
  thinkingLevel?: ThinkingLevel
  fast?: boolean
} {
  const alias = parseCursorModelAlias(id.trim())
  const thinkingOff = alias.bracket?.thinking === 'false'
  const normalized = normalizeCursorConversationModel(id)
  return {
    thinkingLevel: thinkingOff ? 'off' : normalized.thinkingLevel,
    fast: normalized.fast
  }
}

export function normalizeCursorConversationModel(model: string): {
  model: string
  thinkingLevel?: ThinkingLevel
  fast?: boolean
  migrated: boolean
} {
  const trimmed = model.trim()
  const alias = parseCursorModelAlias(trimmed)
  if (alias.auto) {
    return { model: 'auto', migrated: trimmed !== 'auto' && trimmed !== '' }
  }
  return {
    model: alias.family,
    thinkingLevel: effortToThinkingLevel(
      alias.effort ?? alias.bracket?.effort ?? alias.bracket?.reasoning
    ),
    fast: alias.fast ?? (alias.bracket?.fast === 'true' ? true : alias.bracket?.fast === 'false' ? false : undefined),
    migrated: alias.family !== trimmed
  }
}

export function parseCursorModelAlias(id: string): {
  family: string
  thinking?: boolean
  effort?: string
  fast?: boolean
  auto?: boolean
  bracket?: Record<string, string>
} {
  if (/^(auto|default|default\[\])$/i.test(id)) return { family: 'default', auto: true }

  const bracket = id.indexOf('[')
  if (bracket >= 0) {
    const family = id.slice(0, bracket)
    const body = id.endsWith(']') ? id.slice(bracket + 1, -1) : id.slice(bracket + 1)
    const params: Record<string, string> = {}
    if (body.trim()) {
      for (const part of body.split(',')) {
        const eq = part.indexOf('=')
        if (eq <= 0) continue
        const key = part.slice(0, eq).trim()
        const value = part.slice(eq + 1).trim()
        if (key) params[key] = value
      }
    }
    return { family, bracket: params }
  }

  let rest = id.startsWith('cursor-') ? id.slice(7) : id
  let fast: boolean | undefined
  if (rest.endsWith('-fast')) {
    fast = true
    rest = rest.slice(0, -5)
  }

  let effort: string | undefined
  const effortMatch = rest.match(/-(low|medium|high|xhigh|max)$/)
  if (effortMatch) {
    effort = effortMatch[1]
    rest = rest.slice(0, -effortMatch[0].length)
  }

  let thinking: boolean | undefined
  if (rest.endsWith('-thinking')) {
    thinking = true
    rest = rest.slice(0, -9)
  }

  return { family: rest, thinking, effort, fast }
}

function effortToThinkingLevel(effort: string | undefined): ThinkingLevel | undefined {
  if (!effort) return undefined
  if (effort === 'off') return 'off'
  if (effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'max') {
    return effort
  }
  if (effort === 'xhigh' || effort === 'extra-high') return 'max'
  return undefined
}

export function cleanCursorLabel(label: string, family: string): string {
  const cleaned = label
    .replace(/\s*\(NO ZDR\)/gi, '')
    .replace(/\s*1M\b/g, '')
    .replace(/\s*Thinking\b/gi, '')
    .replace(/\s*Extra High\b/gi, '')
    .replace(/\s*(?:Low|Medium|High|Max|Fast)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || family
}
