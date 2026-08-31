/**
 * Cursor ACP `session/set_model` rejects the ids from `cursor-agent --list-models`.
 *
 * `--list-models` explodes each family into effort/fast variants
 * (`cursor-grok-4.6-high-fast`). ACP wants a family id plus parameters
 * (`grok-4.6[effort=high,fast=true]`). VAV stores the family and applies
 * thinking / fast from the session-run chips.
 */

import {
  collapseCursorListModels,
  cursorFamilyAllowsThinkingOverlay,
  cursorModelFamilyId,
  isCursorPickerAlias,
  normalizeCursorConversationModel,
  parseCursorModelAlias,
  prefsFromCursorModelId
} from '../../../shared/cursorModel.ts'
import type { ThinkingLevel } from '../../../shared/types.ts'

export {
  collapseCursorListModels,
  cursorFamilyAllowsThinkingOverlay,
  cursorModelFamilyId,
  isCursorPickerAlias,
  normalizeCursorConversationModel
}

export function advertisedThinkingLevel(
  wanted: string,
  available: AcpListedModel[]
): ThinkingLevel | undefined {
  const listed = findListedFamily(available, parseCursorModelAlias(wanted.trim()).family)
  if (!listed) return undefined
  return prefsFromCursorModelId(listed.modelId).thinkingLevel
}

export type AcpListedModel = {
  modelId: string
  name?: string
}

export type AcpModelPrefs = {
  thinkingLevel?: ThinkingLevel | null
  fast?: boolean | null
}

export function parseAcpAvailableModels(models: unknown): AcpListedModel[] {
  const rows = Array.isArray(models)
    ? models
    : models && typeof models === 'object' && !Array.isArray(models)
      ? arrayOf((models as Record<string, unknown>).availableModels) ??
        arrayOf((models as Record<string, unknown>).available_models)
      : null
  if (!rows) return []
  const out: AcpListedModel[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const rec = row as Record<string, unknown>
    const modelId =
      (typeof rec.modelId === 'string' && rec.modelId) ||
      (typeof rec.model_id === 'string' && rec.model_id) ||
      (typeof rec.id === 'string' && rec.id) ||
      ''
    if (!modelId) continue
    const name = typeof rec.name === 'string' ? rec.name : undefined
    out.push(name ? { modelId, name } : { modelId })
  }
  return out
}

/**
 * ACP id to pin before the session exists (no availableModels yet).
 * Used for `cursor-agent --model` and `session/new.modelId` so Cursor
 * does not initialize Auto / the last account default against the wrong pool.
 */
export function acpBootstrapModelId(
  wanted: string | null | undefined,
  prefs?: AcpModelPrefs
): string | null {
  const trimmed = wanted?.trim()
  if (!trimmed) return null
  return resolveAcpModelId(trimmed, [], prefs)
}

/** Prefer the overlaid ACP id, then the family's advertised default, then the raw pick. */
export function acpModelIdCandidates(
  wanted: string,
  available: AcpListedModel[] = [],
  prefs?: AcpModelPrefs
): string[] {
  const trimmed = wanted.trim()
  if (!trimmed) return []
  const resolved = resolveAcpModelId(trimmed, available, prefs)
  const familyDefault = familyDefaultId(trimmed, available)
  const constructed = resolveAcpModelId(trimmed, [], prefs)
  return unique([resolved, familyDefault, constructed, trimmed])
}

export function resolveAcpModelId(
  wanted: string,
  available: AcpListedModel[] = [],
  prefs?: AcpModelPrefs
): string {
  const trimmed = wanted.trim()
  if (!trimmed) return trimmed
  if (!prefsActive(prefs) && available.some((model) => model.modelId === trimmed)) {
    return trimmed
  }

  const alias = parseCursorModelAlias(trimmed)
  if (alias.auto) {
    return (
      available.find((model) => model.modelId === 'default[]' || /^auto$/i.test(model.name ?? ''))
        ?.modelId ?? 'default[]'
    )
  }

  const listed = findListedFamily(available, alias.family)
  if (prefsActive(prefs)) {
    if (listed) return overlayPrefs(listed, prefs!, alias)
    return formatFromPrefs(alias.family, prefs!)
  }

  if (listed) return overlayListed(listed, alias)
  if (alias.bracket) return trimmed
  if (alias.thinking || alias.effort || alias.fast != null || trimmed.startsWith('cursor-')) {
    return formatFromAlias(alias)
  }
  return trimmed
}

type PickerAlias = ReturnType<typeof parseCursorModelAlias>

function parseAcpModelId(id: string): { family: string; params: Record<string, string>; order: string[] } {
  const match = id.match(/^([^[]+)\[(.*)\]$/)
  if (!match) return { family: id, params: {}, order: [] }
  const family = match[1] ?? id
  const params: Record<string, string> = {}
  const order: string[] = []
  const body = match[2] ?? ''
  if (!body.trim()) return { family, params, order }
  for (const part of body.split(',')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (!key) continue
    params[key] = value
    order.push(key)
  }
  return { family, params, order }
}

function findListedFamily(available: AcpListedModel[], family: string): AcpListedModel | undefined {
  const keys = unique([family, family.replace(/^cursor-/, '')])
  return available.find((model) => {
    const parsed = parseAcpModelId(model.modelId)
    return keys.includes(parsed.family) || (model.name != null && keys.includes(model.name))
  })
}

function familyDefaultId(wanted: string, available: AcpListedModel[]): string | null {
  const alias = parseCursorModelAlias(wanted.trim())
  if (alias.auto) return null
  return findListedFamily(available, alias.family)?.modelId ?? null
}

function prefsActive(prefs?: AcpModelPrefs): boolean {
  return !!prefs && (prefs.thinkingLevel != null || prefs.fast != null)
}

function overlayListed(listed: AcpListedModel, alias: PickerAlias): string {
  const base = parseAcpModelId(listed.modelId)
  const params = { ...base.params }
  if (alias.bracket) {
    Object.assign(params, alias.bracket)
    return formatAcpModelId(base.family, params, base.order)
  }

  if ('thinking' in base.params || alias.thinking) {
    params.thinking = alias.thinking ? 'true' : 'false'
  }
  if (alias.effort) {
    if ('reasoning' in base.params) params.reasoning = alias.effort
    else params.effort = alias.effort
  }
  if ('fast' in base.params || alias.fast) {
    params.fast = alias.fast ? 'true' : 'false'
  }
  return formatAcpModelId(base.family, params, base.order)
}

function overlayPrefs(listed: AcpListedModel, prefs: AcpModelPrefs, alias: PickerAlias): string {
  const base = parseAcpModelId(listed.modelId)
  const params = { ...base.params }
  applyThinkingPrefs(params, base.family, base.params, prefs.thinkingLevel)
  if (prefs.fast != null && ('fast' in base.params || supportsFast(alias.family) || supportsFast(base.family))) {
    params.fast = prefs.fast ? 'true' : 'false'
  }
  return formatAcpModelId(base.family, params, base.order)
}

function formatFromPrefs(family: string, prefs: AcpModelPrefs): string {
  const params: Record<string, string> = {}
  const order: string[] = []
  applyThinkingPrefs(params, family, {}, prefs.thinkingLevel)
  if (prefs.fast != null && (supportsFast(family) || prefs.fast)) {
    params.fast = prefs.fast ? 'true' : 'false'
  }
  order.push(...Object.keys(params))
  return formatAcpModelId(family, params, order)
}

function applyThinkingPrefs(
  params: Record<string, string>,
  family: string,
  baseParams: Record<string, string>,
  level?: ThinkingLevel | null
): void {
  if (level == null) return
  const reasoning = 'reasoning' in baseParams || usesReasoning(family)
  const effort = 'effort' in baseParams || usesEffort(family)
  const thinking = 'thinking' in baseParams || usesThinkingFlag(family)

  if (thinking) params.thinking = level === 'off' ? 'false' : 'true'
  if (reasoning) {
    params.reasoning = level === 'off' ? 'low' : level === 'max' ? 'max' : level
  }
  if (effort && level !== 'off') {
    params.effort = level === 'max' ? 'max' : level
  }
}

function formatFromAlias(alias: PickerAlias): string {
  if (alias.auto) return 'default[]'
  const params: Record<string, string> = {}
  const order: string[] = []
  if (alias.thinking != null) {
    params.thinking = alias.thinking ? 'true' : 'false'
    order.push('thinking')
  }
  if (alias.effort) {
    const key = usesReasoning(alias.family) ? 'reasoning' : 'effort'
    params[key] = alias.effort
    order.push(key)
  }
  if (alias.fast != null) {
    params.fast = alias.fast ? 'true' : 'false'
    order.push('fast')
  }
  return formatAcpModelId(alias.family, params, order)
}

function usesReasoning(family: string): boolean {
  return /^gpt-/i.test(family) || /codex/i.test(family) || /^kimi/i.test(family) || /^glm/i.test(family)
}

function usesThinkingFlag(family: string): boolean {
  return /claude/i.test(family)
}

function usesEffort(family: string): boolean {
  return /^(grok|claude|gemini)/i.test(family)
}

function supportsFast(family: string): boolean {
  return /^(grok|claude|gpt-|composer)/i.test(family) || /codex/i.test(family)
}

function formatAcpModelId(
  family: string,
  params: Record<string, string>,
  order: string[]
): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const key of order) {
    const value = params[key]
    if (value == null || value === '') continue
    seen.add(key)
    parts.push(`${key}=${value}`)
  }
  for (const [key, value] of Object.entries(params)) {
    if (seen.has(key) || value == null || value === '') continue
    parts.push(`${key}=${value}`)
  }
  return `${family}[${parts.join(',')}]`
}

function unique(values: Array<string | null | undefined>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function arrayOf(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}
