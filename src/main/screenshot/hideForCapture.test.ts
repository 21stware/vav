import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nativeCaptureExcludePid } from './hideForCapture.ts'

describe('nativeCaptureExcludePid', () => {
  it('excludes the app pid only when windows were hidden', () => {
    assert.equal(nativeCaptureExcludePid(true, 4242), 4242)
    assert.equal(nativeCaptureExcludePid(false, 4242), 0)
    assert.equal(nativeCaptureExcludePid(true, 0), 0)
  })
})
