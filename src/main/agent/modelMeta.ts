/**
 * Model metadata backed by pi-ai's generated provider catalogs.
 *
 * vav's own tables (`@shared/tokenUsage`, `@shared/thinkingLevel`,
 * `@shared/agentImageInput`) answer by substring guessing; pi-ai ships curated
 * per-model data (context window, output cap, $/MTok, reasoning support, input
 * modalities, thinking-level mapping). This module looks ids up in those
 * catalogs first and falls back to the shared regex heuristics for anything
 * the catalogs do not know.
 *
 * Main-process only: the catalogs ride pi-ai's ESM graph, which is bundled
 * into the main bundle (see electron.vite.config.ts) and never reaches the
 * renderer. Shared imports are relative so `node --test` can load this module.
 */
import type { Api, Model, ThinkingLevelMap } from '@earendil-works/pi-ai'
import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models'
import { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models'
import { GOOGLE_MODELS } from '@earendil-works/pi-ai/providers/google.models'
import { DEEPSEEK_MODELS } from '@earendil-works/pi-ai/providers/deepseek.models'
import { XAI_MODELS } from '@earendil-works/pi-ai/providers/xai.models'
import { MOONSHOTAI_MODELS } from '@earendil-works/pi-ai/providers/moonshotai.models'
import { ZAI_MODELS } from '@earendil-works/pi-ai/providers/zai.models'
import { MINIMAX_MODELS } from '@earendil-works/pi-ai/providers/minimax.models'
import { MISTRAL_MODELS } from '@earendil-works/pi-ai/providers/mistral.models'
import { OPENROUTER_MODELS } from '@earendil-works/pi-ai/providers/openrouter.models'
import { GROQ_MODELS } from '@earendil-works/pi-ai/providers/groq.models'
import { TOGETHER_MODELS } from '@earendil-works/pi-ai/providers/together.models'
import {
  resolveContextWindow,
  resolveMaxTokens,
  type ModelRates
} from '../../shared/tokenUsage.ts'
import { vavModelSupportsThinking } from '../../shared/thinkingLevel.ts'
import { modelAcceptsImageInput } from '../../shared/agentImageInput.ts'

type CatalogRecord = Record<string, Model<Api>>

/**
 * Lookup priority: first-party providers first so a bare id never resolves to
 * an aggregator's mirror of another vendor's model. Aggregator ids carry a
 * `vendor/` prefix, so they only match when the user actually typed one.
 */
const CATALOGS: ReadonlyArray<readonly [string, CatalogRecord]> = [
  ['anthropic', ANTHROPIC_MODELS as CatalogRecord],
  ['openai', OPENAI_MODELS as CatalogRecord],
  ['google', GOOGLE_MODELS as CatalogRecord],
  ['deepseek', DEEPSEEK_MODELS as CatalogRecord],
  ['xai', XAI_MODELS as CatalogRecord],
  ['moonshotai', MOONSHOTAI_MODELS as CatalogRecord],
  ['zai', ZAI_MODELS as CatalogRecord],
  ['minimax', MINIMAX_MODELS as CatalogRecord],
  ['mistral', MISTRAL_MODELS as CatalogRecord],
  ['openrouter', OPENROUTER_MODELS as CatalogRecord],
  ['groq', GROQ_MODELS as CatalogRecord],
  ['together', TOGETHER_MODELS as CatalogRecord]
]

export interface CatalogModelMeta {
  providerId: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
  input: readonly ('text' | 'image')[]
  /** $/MTok, same shape as vav's rate table. */
  rates: ModelRates
  thinkingLevelMap?: ThinkingLevelMap
}

interface IndexEntry {
  providerId: string
  model: Model<Api>
}

/** id (exact and lowercased) → entry, plus the lowercase map for case-insensitive ids. */
const index = new Map<string, IndexEntry>()
const lowerIndex = new Map<string, IndexEntry>()

for (const [providerId, catalog] of CATALOGS) {
  for (const [id, model] of Object.entries(catalog)) {
    const entry: IndexEntry = { providerId, model }
    if (!index.has(id)) index.set(id, entry)
    const lower = id.toLowerCase()
    if (!lowerIndex.has(lower)) lowerIndex.set(lower, entry)
  }
}

/** Trailing date/version stamps providers publish snapshot ids under. */
const DATE_SUFFIXES = [
  /-\d{8}$/, // claude-sonnet-4-5-20250929
  /-\d{4}-\d{2}-\d{2}$/, // gpt-4o-2024-08-06
  /-\d{2}-\d{4}$/, // gemini-2.5-flash-preview-05-2025
  /-\d{4}$/ // grok-4-2025
]

/** Strip one round of date-ish suffixes; returns null when nothing stripped. */
function stripDateSuffix(id: string): string | null {
  for (const pattern of DATE_SUFFIXES) {
    if (pattern.test(id)) return id.replace(pattern, '')
  }
  return null
}

/**
 * Resolve a model id against the catalogs. Exact match wins, then
 * case-insensitive, then dated snapshot variants (`-20250929`,
 * `-2024-08-06`, …) — at most two rounds, so `claude-sonnet-4-5-20250929`
 * lands on `claude-sonnet-4-5` while a genuinely unknown id stays unknown.
 */
export function lookupCatalogModel(modelId: string | null | undefined): CatalogModelMeta | null {
  const id = (modelId ?? '').trim()
  if (!id) return null

  const exact = index.get(id)
  if (exact) return metaOf(exact)

  const strippedId = stripDateSuffix(id)
  if (strippedId) {
    const stripped = index.get(strippedId)
    if (stripped) return metaOf(stripped)
    const strippedTwice = stripDateSuffix(strippedId)
    if (strippedTwice) {
      const second = index.get(strippedTwice)
      if (second) return metaOf(second)
    }
  }

  const lower = id.toLowerCase()
  const ci = lowerIndex.get(lower)
  if (ci) return metaOf(ci)

  if (strippedId) {
    const ciStripped = lowerIndex.get(strippedId.toLowerCase())
    if (ciStripped) return metaOf(ciStripped)
  }
  return null
}

function metaOf(entry: IndexEntry): CatalogModelMeta {
  const model = entry.model
  return {
    providerId: entry.providerId,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning: model.reasoning,
    input: model.input,
    rates: {
      input: model.cost.input,
      output: model.cost.output,
      cacheWrite: model.cost.cacheWrite,
      cacheRead: model.cost.cacheRead
    },
    ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {})
  }
}

/** Context window in tokens — catalog hit over the shared regex table. */
export function contextWindowFor(modelId: string | null | undefined): number {
  const meta = lookupCatalogModel(modelId)
  if (meta && meta.contextWindow > 0) return meta.contextWindow
  return resolveContextWindow(modelId)
}

/** Per-request output cap — catalog hit over the shared regex table. */
export function maxTokensFor(modelId: string | null | undefined): number {
  const meta = lookupCatalogModel(modelId)
  if (meta && meta.maxTokens > 0) return meta.maxTokens
  return resolveMaxTokens(modelId)
}

/** $/MTok when the catalog knows the model, else null (caller falls back). */
export function catalogRatesFor(modelId: string | null | undefined): ModelRates | null {
  const meta = lookupCatalogModel(modelId)
  if (!meta) return null
  const { rates } = meta
  if (
    !Number.isFinite(rates.input) ||
    !Number.isFinite(rates.output) ||
    !Number.isFinite(rates.cacheRead) ||
    !Number.isFinite(rates.cacheWrite)
  ) {
    return null
  }
  return rates
}

/** Thinking / reasoning-effort support — catalog hit over the shared heuristic. */
export function modelSupportsThinking(modelId: string | null | undefined): boolean {
  const meta = lookupCatalogModel(modelId)
  if (meta) return meta.reasoning
  return vavModelSupportsThinking(modelId ?? '')
}

/** Image input support — catalog hit over the shared vision regex. */
export function modelAcceptsImage(modelId: string | null | undefined): boolean {
  const meta = lookupCatalogModel(modelId)
  if (meta) return meta.input.includes('image')
  return modelAcceptsImageInput('vav', modelId ?? '')
}

/** Provider-native thinking-level mapping, when the catalog published one. */
export function thinkingLevelMapFor(modelId: string | null | undefined): ThinkingLevelMap | undefined {
  return lookupCatalogModel(modelId)?.thinkingLevelMap
}
