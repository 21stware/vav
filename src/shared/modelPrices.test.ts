import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  lookupModelRates,
  mergeModelPriceTable,
  parseModelsDevCatalog
} from './modelPrices.ts'

describe('parseModelsDevCatalog', () => {
  it('reads provider.models.cost and ignores rows without prices', () => {
    const catalog = parseModelsDevCatalog({
      anthropic: {
        models: {
          'claude-sonnet-4-5': {
            id: 'claude-sonnet-4-5',
            cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 }
          },
          'no-price': { id: 'no-price' }
        }
      }
    })
    assert.deepEqual(catalog['claude-sonnet-4-5'], {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75
    })
    assert.equal(catalog['no-price'], undefined)
  })
})

describe('lookupModelRates', () => {
  const table = mergeModelPriceTable(
    { 'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
    { 'my-alias': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 } }
  )

  it('prefers a local override and matches dated aliases', () => {
    assert.deepEqual(lookupModelRates(table, 'my-alias'), {
      input: 1,
      output: 2,
      cacheRead: 0.1,
      cacheWrite: 1
    })
    assert.equal(lookupModelRates(table, 'claude-sonnet-4-5-20250929')?.input, 3)
    assert.equal(lookupModelRates(table, 'unknown-model'), null)
  })
})
