import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { APP_SPLIT_MIN_WIDTH, appSplitLayout } from './applicationsWidth.ts'

describe('appSplitLayout', () => {
  it('stacks below the tablet split threshold and splits at or above it', () => {
    assert.equal(appSplitLayout(APP_SPLIT_MIN_WIDTH - 1), 'stack')
    assert.equal(appSplitLayout(380), 'stack')
    assert.equal(appSplitLayout(APP_SPLIT_MIN_WIDTH), 'split')
    assert.equal(appSplitLayout(720), 'split')
  })
})
