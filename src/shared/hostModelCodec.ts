/**
 * Host-agnostic model id codec.
 *
 * Canonical record: family + param bag + writable.
 * Wire dialects stay on a table — Cursor CLI hyphens, Cursor ACP brackets,
 * Grok's independent effort axis, everything else opaque.
 *
 * Display rule (from the advertised table, not a guess):
 *   abc-medium              → picker row `abc-medium` (atomic)
 *   abc[effort=medium]      → picker row `abc`, effort chip = medium
 */

import type { ModelOption, ThinkingLevel } from './types.ts'
import {
  cleanCursorLabel,
  cursorModelFamilyId,
  parseCursorModelAlias
} from './cursorModel.ts'

export type ModelDialect = 'cursor-cli' | 'cursor-acp' | 'grok-acp' | 'opaque'

export type ParamWritable = 'open' | 'locked' | 'unknown'

export type CanonicalParam = {
  key: string
  value: string
  writable: ParamWritable
  options?: string[]
}

export type CanonicalModel = {
  family: string
  arity: 'atomic' | 'parameterized'
  dialect: ModelDialect
  wireId: string
  label?: string
  params: CanonicalParam[]
  auto?: boolean
}

export type CatalogRow = {
  id: string
  label?: string
  name?: string
}

export type ModelPrefs = {
  thinkingLevel?: ThinkingLevel | null
  fast?: boolean | null
}

const THINKING_KEYS = new Set(['effort', 'reasoning', 'reasoning_effort'])

export function detectModelDialect(rows: readonly CatalogRow[]): ModelDialect {
  let brackets = 0
  let hyphens = 0
  for (const row of rows) {
    const id = row.id.trim()
    if (!id) continue
    if (id.includes('[')) brackets += 1
    else if (isHyphenVariant(id)) hyphens += 1
  }
  if (brackets > 0 && brackets >= hyphens) return 'cursor-acp'
  if (hyphens > 0) return 'cursor-cli'
  return 'opaque'
}

export function parseHostModelId(id: string, dialect?: ModelDialect): CanonicalModel {
  const trimmed = id.trim()
  const resolved = dialect ?? inferDialectFromId(trimmed)
  if (/^(auto|default|default\[\])$/i.test(trimmed)) {
    return {
      family: 'default',
      arity: 'atomic',
      dialect: resolved === 'opaque' ? 'cursor-acp' : resolved,
      wireId: trimmed === 'auto' ? 'auto' : 'default[]',
      auto: true,
      params: []
    }
  }
  if (trimmed.includes('[')) {
    const alias = parseCursorModelAlias(trimmed)
    const params = paramsFromBracket(alias.bracket ?? {})
    return {
      family: alias.family,
      arity: 'parameterized',
      dialect: 'cursor-acp',
      wireId: trimmed,
      params
    }
  }
  if (isHyphenVariant(trimmed)) {
    const alias = parseCursorModelAlias(trimmed)
    return {
      family: alias.auto ? 'default' : alias.family,
      arity: 'atomic',
      dialect: 'cursor-cli',
      wireId: trimmed,
      auto: alias.auto,
      params: paramsFromHyphen(alias)
    }
  }
  const family = cursorModelFamilyId(trimmed) || trimmed
  return {
    family,
    arity: resolved === 'grok-acp' ? 'parameterized' : 'atomic',
    dialect: resolved,
    wireId: trimmed,
    params: []
  }
}

export function classifyCatalog(
  rows: readonly CatalogRow[],
  dialect = detectModelDialect(rows)
): CanonicalModel[] {
  if (dialect === 'cursor-acp') return classifyAcpCatalog(rows)
  return rows
    .filter((row) => row.id.trim())
    .map((row) => {
      const parsed = parseHostModelId(row.id, dialect)
      return {
        ...parsed,
        label: row.label ?? row.name,
        dialect
      }
    })
}

/** Picker rows: hyphen catalogs stay atomic; bracket catalogs collapse to family. */
export function presentHostCatalog(rows: readonly ModelOption[]): ModelOption[] {
  const dialect = detectModelDialect(rows)
  if (dialect === 'cursor-acp') {
    const classified = classifyAcpCatalog(rows)
    return classified.map((model) => {
      const thinking = thinkingOptions(model)
      const defaultLevel = thinking[thinking.length - 1]
      return {
        id: model.auto ? 'auto' : model.family,
        label: model.label || model.family,
        ...(thinking.length ? { thinkingLevels: thinking } : {}),
        ...(defaultLevel ? { defaultThinkingLevel: defaultLevel } : {})
      }
    })
  }
  return rows
    .filter((row) => row.id.trim())
    .map((row) => ({ ...row }))
}

export function catalogRowForModel(
  list: readonly ModelOption[],
  modelId: string
): ModelOption | undefined {
  const trimmed = modelId.trim()
  if (!trimmed) return list.find((row) => !row.id)
  const exact = list.find((row) => row.id === trimmed)
  if (exact) return exact
  const family = cursorModelFamilyId(trimmed)
  return (
    list.find((row) => row.id === family) ??
    list.find((row) => cursorModelFamilyId(row.id) === family)
  )
}

export function sessionModelIsAtomic(cliHost: string | null | undefined, modelId: string | null | undefined): boolean {
  if (cliHost && cliHost !== 'cursor') return false
  const raw = (modelId ?? '').trim()
  if (!raw) return false
  return parseHostModelId(raw).arity === 'atomic' && isHyphenVariant(raw)
}

/** CLI `--model` id. Never a bracket string. Atomic hyphen ids stay as-is. */
export function encodeCursorCliModelId(
  wanted: string | null | undefined,
  prefs?: ModelPrefs
): string | null {
  const trimmed = wanted?.trim()
  if (!trimmed) return null
  const parsed = parseHostModelId(trimmed)
  if (parsed.auto) return 'auto'
  if (isHyphenVariant(parsed.wireId)) return parsed.wireId
  return buildCursorCliId(parsed.family, mergePrefs(parsed, prefs))
}

/** ACP `session/set_model` id — exact advertised row for the family, or null. */
export function encodeCursorAcpModelId(
  wanted: string | null | undefined,
  catalog: readonly CatalogRow[] = []
): string | null {
  const trimmed = wanted?.trim()
  if (!trimmed) return null
  const parsed = parseHostModelId(trimmed)
  if (parsed.auto) {
    return (
      catalog.find((row) => row.id === 'default[]' || /^auto$/i.test(row.name ?? row.label ?? ''))
        ?.id ?? 'default[]'
    )
  }
  const family = parsed.family
  const keys = unique([family, family.replace(/^cursor-/, ''), `cursor-${family}`])
  const hit = catalog.find((row) => {
    const rowFamily = parseHostModelId(row.id).family
    return keys.includes(rowFamily) || keys.includes(row.name ?? '') || keys.includes(row.label ?? '')
  })
  return hit?.id ?? null
}

export function thinkingParamValue(level: ThinkingLevel | null | undefined): string | null {
  if (level == null || level === 'off') return null
  if (level === 'max') return 'xhigh'
  return level
}

function inferDialectFromId(id: string): ModelDialect {
  if (id.includes('[')) return 'cursor-acp'
  if (isHyphenVariant(id)) return 'cursor-cli'
  return 'opaque'
}

export function isHyphenVariant(id: string): boolean {
  const trimmed = id.trim()
  if (!trimmed || trimmed.includes('[')) return false
  if (/^(auto|default)$/i.test(trimmed)) return false
  return (
    /-(?:thinking-)?(?:low|medium|high|xhigh|max|none|minimal|extra-high)(?:-fast)?$/.test(
      trimmed
    ) || /-(?:fast)$/.test(trimmed)
  )
}

function classifyAcpCatalog(rows: readonly CatalogRow[]): CanonicalModel[] {
  const groups = new Map<string, { sample: CanonicalModel; wires: string[]; label?: string }>()
  for (const row of rows) {
    const parsed = parseHostModelId(row.id, 'cursor-acp')
    const key = parsed.auto ? 'default' : parsed.family
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        sample: parsed,
        wires: [parsed.wireId],
        label: row.label ?? row.name ?? (parsed.auto ? 'Auto' : parsed.family)
      })
      continue
    }
    existing.wires.push(parsed.wireId)
  }
  return [...groups.values()].map(({ sample, wires, label }) => {
    const optionSets = collectParamOptions(wires)
    const params = sample.params.map((param) => {
      const options = optionSets.get(param.key) ?? [param.value]
      return {
        ...param,
        options,
        writable: options.length > 1 ? ('open' as const) : ('locked' as const)
      }
    })
    return {
      ...sample,
      label,
      params,
      arity: sample.auto ? 'atomic' : 'parameterized',
      wireId: sample.auto ? 'default[]' : sample.family
    }
  })
}

function collectParamOptions(wires: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const wire of wires) {
    for (const param of parseHostModelId(wire, 'cursor-acp').params) {
      const list = out.get(param.key) ?? []
      if (!list.includes(param.value)) list.push(param.value)
      out.set(param.key, list)
    }
  }
  return out
}

function paramsFromBracket(bracket: Record<string, string>): CanonicalParam[] {
  const params: CanonicalParam[] = []
  for (const [rawKey, value] of Object.entries(bracket)) {
    const key = THINKING_KEYS.has(rawKey) ? 'thinking' : rawKey
    if (params.some((param) => param.key === key && key === 'thinking')) continue
    params.push({ key, value, writable: 'unknown' })
  }
  return params
}

function paramsFromHyphen(alias: ReturnType<typeof parseCursorModelAlias>): CanonicalParam[] {
  const params: CanonicalParam[] = []
  if (alias.effort) params.push({ key: 'thinking', value: alias.effort, writable: 'locked' })
  if (alias.fast != null) params.push({ key: 'fast', value: alias.fast ? 'true' : 'false', writable: 'locked' })
  if (alias.thinking != null) {
    params.push({ key: 'thinkingFlag', value: alias.thinking ? 'true' : 'false', writable: 'locked' })
  }
  return params
}

function thinkingOptions(model: CanonicalModel): ThinkingLevel[] {
  const param = model.params.find((row) => row.key === 'thinking')
  if (!param) return []
  const values = param.options ?? [param.value]
  const levels: ThinkingLevel[] = []
  for (const value of values) {
    const level = effortToLevel(value)
    if (level && !levels.includes(level)) levels.push(level)
  }
  return levels
}

function effortToLevel(effort: string): ThinkingLevel | undefined {
  if (effort === 'off' || effort === 'false') return 'off'
  if (effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'max') return effort
  if (effort === 'xhigh' || effort === 'extra-high') return 'max'
  return undefined
}

function mergePrefs(parsed: CanonicalModel, prefs?: ModelPrefs): Required<ModelPrefs> {
  const thinking =
    prefs?.thinkingLevel ??
    effortToLevel(parsed.params.find((param) => param.key === 'thinking')?.value ?? '') ??
    null
  const fastParam = parsed.params.find((param) => param.key === 'fast')
  const fast =
    prefs?.fast ??
    (fastParam?.value === 'true' ? true : fastParam?.value === 'false' ? false : null)
  return { thinkingLevel: thinking, fast }
}

function buildCursorCliId(family: string, prefs: Required<ModelPrefs>): string {
  const base = family.replace(/^cursor-/, '')
  const effort = thinkingParamValue(prefs.thinkingLevel)
  const fast = prefs.fast === true
  if (/^grok/i.test(base)) {
    const level = effort ?? 'medium'
    return `cursor-${base}-${level}${fast ? '-fast' : ''}`
  }
  if (/^gemini/i.test(base)) {
    const level = effort ?? 'medium'
    return `${base}-${level}`
  }
  if (/^composer/i.test(base)) {
    return `${base}${fast ? '-fast' : ''}`
  }
  if (/claude/i.test(base)) {
    const level = effort ?? 'high'
    const thinkingOn = prefs.thinkingLevel != null && prefs.thinkingLevel !== 'off'
    return `${base}${thinkingOn ? '-thinking' : ''}-${level}${fast ? '-fast' : ''}`
  }
  if (/^gpt-|codex|kimi|glm/i.test(base)) {
    const level = prefs.thinkingLevel === 'off' ? 'none' : (effort ?? 'medium')
    return `${base}-${level}${fast ? '-fast' : ''}`
  }
  if (effort) return `${base}-${effort}${fast ? '-fast' : ''}`
  return fast ? `${base}-fast` : base
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

/** @deprecated Use {@link presentHostCatalog}. Hyphen catalogs are no longer collapsed. */
export function collapseCursorListModels(models: ModelOption[]): ModelOption[] {
  return presentHostCatalog(models)
}

export { cleanCursorLabel }
