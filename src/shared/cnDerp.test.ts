import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sidecarDerpHostArgs, VAV_CN_DERP_HOST } from './cnDerp.ts'

describe('cnDerp', () => {
  it('pins the filed mainland relay hostname', () => {
    assert.equal(VAV_CN_DERP_HOST, 'derp.vavapp.art')
    assert.deepEqual(sidecarDerpHostArgs(), ['--derp-host', 'derp.vavapp.art'])
  })
})
