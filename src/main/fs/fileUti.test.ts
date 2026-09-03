import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mimeHintToUti } from './fileUti.ts'

describe('mimeHintToUti', () => {
  it('maps known extensions and falls back to public.data', () => {
    assert.equal(mimeHintToUti('.dmg'), 'com.apple.disk-image-udif')
    assert.equal(mimeHintToUti('.pkg'), 'com.apple.installer-package-archive')
    assert.equal(mimeHintToUti('.app'), 'com.apple.application-bundle')
    assert.equal(mimeHintToUti('.zip'), 'com.pkware.zip-archive')
    assert.equal(mimeHintToUti('.apk'), 'com.android.package-archive')
    assert.equal(mimeHintToUti('.txt'), 'public.data')
  })
})
