import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyProductName,
  brandDisplayName,
  formatSystemIdentity,
  parseBrandIdentity
} from './brandIdentity.ts'

describe('parseBrandIdentity', () => {
  it('fills defaults and keeps a custom display name', () => {
    const brand = parseBrandIdentity({ displayName: 'Acme' })
    assert.equal(brand.displayName, 'Acme')
    assert.equal(brand.appId, 'com.vav.app')
    assert.match(brand.systemIdentity, /\{product\}/)
  })
})

describe('applyProductName', () => {
  it('leaves VAV copy alone and replaces the standalone product word', () => {
    assert.equal(applyProductName('Open VAV', 'VAV'), 'Open VAV')
    assert.equal(applyProductName('Open VAV', 'Acme'), 'Open Acme')
    assert.equal(applyProductName('start vav-server then VAV', 'Acme'), 'start vav-server then Acme')
  })
})

describe('formatSystemIdentity', () => {
  it('substitutes product and OS', () => {
    assert.equal(
      formatSystemIdentity('macOS'),
      "You are VAV, a local coding agent running on the user's macOS machine."
    )
    assert.equal(brandDisplayName(), 'VAV')
  })
})
