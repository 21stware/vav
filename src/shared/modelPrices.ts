export interface ModelRates {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

export interface ModelPriceEntry {
  id: string
  rates: ModelRates
}

export interface ModelPriceTable {
  updatedAt: number | null
  /** Canonical lowercase model id → $/MTok. */
  catalog: Record<string, ModelRates>
  /** Local overrides win over the catalog. */
  overrides: Record<string, ModelRates>
}

export const EMPTY_MODEL_PRICE_TABLE: ModelPriceTable = {
  updatedAt: null,
  catalog: {},
  overrides: {}
}

function finiteRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function ratesFromCost(cost: Record<string, unknown> | null | undefined): ModelRates | null {
  if (!cost) return null
  const input = finiteRate(cost.input)
  const output = finiteRate(cost.output)
  if (input == null || output == null) return null
  return {
    input,
    output,
    cacheWrite: finiteRate(cost.cache_write) ?? finiteRate(cost.cacheWrite) ?? input,
    cacheRead: finiteRate(cost.cache_read) ?? finiteRate(cost.cacheRead) ?? 0
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** models.dev `api.json` — providers → models → cost. Tolerate shape drift. */
export function parseModelsDevCatalog(raw: unknown): Record<string, ModelRates> {
  const root = asRecord(raw)
  if (!root) return {}
  const catalog: Record<string, ModelRates> = {}
  for (const provider of Object.values(root)) {
    const rec = asRecord(provider)
    if (!rec) continue
    const models = asRecord(rec.models) ?? rec
    for (const [id, model] of Object.entries(models)) {
      const row = asRecord(model)
      if (!row) continue
      const rates = ratesFromCost(asRecord(row.cost) ?? asRecord(row.pricing))
      if (!rates) continue
      const key = (typeof row.id === 'string' && row.id.trim() ? row.id : id).trim().toLowerCase()
      if (key) catalog[key] = rates
    }
  }
  return catalog
}

export function normalizeModelPriceId(modelId: string | null | undefined): string {
  return (modelId ?? '').trim().toLowerCase()
}

function lookupExact(table: ModelPriceTable, id: string): ModelRates | null {
  return table.overrides[id] ?? table.catalog[id] ?? null
}

/** Exact id, then suffix / contains match for dated Anthropic / OpenAI aliases. */
export function lookupModelRates(
  table: ModelPriceTable,
  modelId: string | null | undefined
): ModelRates | null {
  const id = normalizeModelPriceId(modelId)
  if (!id) return null
  const exact = lookupExact(table, id)
  if (exact) return exact
  const bare = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  if (bare !== id) {
    const aliased = lookupExact(table, bare)
    if (aliased) return aliased
  }
  let bestKey = ''
  let bestRates: ModelRates | null = null
  const consider = (key: string, rates: ModelRates): void => {
    if (key.length < 4) return
    if (!id.includes(key) && !key.includes(bare)) return
    if (!bestRates || key.length > bestKey.length) {
      bestKey = key
      bestRates = rates
    }
  }
  for (const [key, rates] of Object.entries(table.overrides)) consider(key, rates)
  for (const [key, rates] of Object.entries(table.catalog)) consider(key, rates)
  return bestRates
}

export function mergeModelPriceTable(
  catalog: Record<string, ModelRates>,
  overrides: Record<string, ModelRates> = {},
  updatedAt: number | null = Date.now()
): ModelPriceTable {
  return { updatedAt, catalog, overrides }
}
