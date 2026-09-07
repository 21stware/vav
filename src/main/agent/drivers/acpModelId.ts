/**
 * Cursor ACP `session/set_model` accepts only the advertised
 * `availableModels` strings. `--list-models` / `--model` use hyphen
 * variants (`cursor-grok-4.6-medium`). Do not invent `[effort=…]`
 * overlays — Cursor rejects them with -32602.
 */

import {
  cursorFamilyAllowsThinkingOverlay,
  cursorModelFamilyId,
  isCursorPickerAlias,
  normalizeCursorConversationModel,
  parseCursorModelAlias,
  prefsFromCursorModelId
} from '../../../shared/cursorModel.ts'
import { encodeCursorAcpModelId, presentHostCatalog } from '../../../shared/hostModelCodec.ts'
import type { ThinkingLevel } from '../../../shared/types.ts'

export {
  cursorFamilyAllowsThinkingOverlay,
  cursorModelFamilyId,
  isCursorPickerAlias,
  normalizeCursorConversationModel
}

export const collapseCursorListModels = presentHostCatalog

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

function toCatalogRows(available: AcpListedModel[]) {
  return available.map((model) => ({ id: model.modelId, name: model.name, label: model.name }))
}

/**
 * `session/new.modelId` is ignored by Cursor. Do not invent overlays
 * before availableModels exists.
 */
export function acpBootstrapModelId(
  wanted: string | null | undefined,
  _prefs?: AcpModelPrefs
): string | null {
  const trimmed = wanted?.trim()
  if (!trimmed) return null
  return encodeCursorAcpModelId(trimmed, [])
}

/** Exact advertised family row only — never a constructed overlay. */
export function acpModelIdCandidates(
  wanted: string,
  available: AcpListedModel[] = [],
  prefs?: AcpModelPrefs
): string[] {
  const trimmed = wanted.trim()
  if (!trimmed) return []
  const advertised = encodeCursorAcpModelId(trimmed, toCatalogRows(available), prefs)
  return advertised ? [advertised] : []
}

export function resolveAcpModelId(
  wanted: string,
  available: AcpListedModel[] = [],
  prefs?: AcpModelPrefs
): string {
  const trimmed = wanted.trim()
  if (!trimmed) return trimmed
  return encodeCursorAcpModelId(trimmed, toCatalogRows(available), prefs) ?? trimmed
}

function findListedFamily(available: AcpListedModel[], family: string): AcpListedModel | undefined {
  const keys = unique([family, family.replace(/^cursor-/, ''), `cursor-${family}`])
  return available.find((model) => {
    const parsed = parseCursorModelAlias(model.modelId)
    return keys.includes(parsed.family) || (model.name != null && keys.includes(model.name))
  })
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
