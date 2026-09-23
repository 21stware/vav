import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  APP_CATALOG_IDS,
  appCatalogPlugin,
  formatAppCatalogCapabilities,
  isAppResourceKind
} from './appPlugins.ts'

describe('app catalog plugins', () => {
  it('lists the four first-party kinds once', () => {
    assert.deepEqual([...APP_CATALOG_IDS], ['knowledge', 'data', 'scheduled', 'storage'])
    assert.equal(isAppResourceKind('knowledge'), true)
    assert.equal(isAppResourceKind('devices'), false)
    assert.equal(appCatalogPlugin('data')?.tools.write, 'analysis_write')
    assert.equal(formatAppCatalogCapabilities(), 'knowledge | data | scheduled | storage')
  })
})
