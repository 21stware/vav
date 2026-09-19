import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  EMPTY_MODEL_PRICE_TABLE,
  mergeModelPriceTable,
  parseModelsDevCatalog,
  type ModelPriceTable,
  type ModelRates
} from '../../shared/modelPrices.ts'
import { setModelPriceTable } from '../../shared/tokenUsage.ts'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const STALE_MS = 12 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 12_000

export class ModelPriceStore {
  private readonly file: string
  private table: ModelPriceTable = { ...EMPTY_MODEL_PRICE_TABLE }
  private loaded = false

  constructor(userData: string) {
    this.file = join(userData, 'model-prices.json')
  }

  load(): ModelPriceTable {
    if (this.loaded) return this.table
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<ModelPriceTable>
        this.table = mergeModelPriceTable(
          raw.catalog && typeof raw.catalog === 'object' ? raw.catalog : {},
          raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {},
          typeof raw.updatedAt === 'number' ? raw.updatedAt : null
        )
      }
    } catch {
      this.table = { ...EMPTY_MODEL_PRICE_TABLE }
    }
    this.loaded = true
    setModelPriceTable(this.table)
    return this.table
  }

  get(): ModelPriceTable {
    return this.load()
  }

  setOverride(modelId: string, rates: ModelRates | null): void {
    this.load()
    const id = modelId.trim().toLowerCase()
    if (!id) return
    const overrides = { ...this.table.overrides }
    if (rates) overrides[id] = rates
    else delete overrides[id]
    this.table = { ...this.table, overrides }
    this.persist()
    setModelPriceTable(this.table)
  }

  async refresh(options?: { force?: boolean; now?: number }): Promise<ModelPriceTable> {
    this.load()
    const now = options?.now ?? Date.now()
    const fresh =
      !options?.force &&
      this.table.updatedAt != null &&
      now - this.table.updatedAt < STALE_MS &&
      Object.keys(this.table.catalog).length > 0
    if (fresh) return this.table
    try {
      const catalog = await fetchModelsDevCatalog()
      if (Object.keys(catalog).length > 0) {
        this.table = mergeModelPriceTable(catalog, this.table.overrides, now)
        this.persist()
        setModelPriceTable(this.table)
      }
    } catch (err) {
      console.warn('[model-prices] models.dev sync failed', err)
    }
    return this.table
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.table), 'utf8')
  }
}

async function fetchModelsDevCatalog(): Promise<Record<string, ModelRates>> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(MODELS_DEV_URL, {
      signal: ac.signal,
      headers: { accept: 'application/json' }
    })
    if (!response.ok) throw new Error(`models.dev ${response.status}`)
    return parseModelsDevCatalog(await response.json())
  } finally {
    clearTimeout(timer)
  }
}
