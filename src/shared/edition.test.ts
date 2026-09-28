import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  activeEdition,
  editionGenericUpdateFeed,
  editionSite,
  mainlandDerpHost,
  parseEditionId
} from './edition.ts'
import { EDITION_ID, EDITIONS } from './edition.generated.ts'

describe('edition', () => {
  it('keeps the mainland relay on every face', () => {
    assert.equal(mainlandDerpHost(), 'derp.vavapp.art')
    assert.equal(EDITIONS.cn.derpHost, 'derp.vavapp.art')
    assert.equal(EDITIONS.cn.site, 'https://vavapp.art')
    assert.equal(EDITIONS.global.site, 'https://vavapp.com')
  })

  it('defaults the baked face to global', () => {
    assert.equal(parseEditionId('cn'), 'cn')
    assert.equal(parseEditionId('nope'), 'global')
    assert.equal(EDITION_ID, 'global')
    assert.equal(activeEdition().id, 'global')
    assert.equal(editionSite(), 'https://vavapp.com')
    assert.equal(editionGenericUpdateFeed(), null)
  })
})
