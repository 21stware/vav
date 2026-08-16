import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldReplaceCliRuntime } from './cliWorkspaceRestart.ts'

describe('shouldReplaceCliRuntime', () => {
  it('keeps a live driver whose cwd still matches', () => {
    assert.equal(shouldReplaceCliRuntime('/a', '/a', false), false)
  })

  it('replaces when the conversation root moved', () => {
    assert.equal(shouldReplaceCliRuntime('/a', '/b', false), true)
  })

  it('replaces a spawn still in flight (cwd may already be stale)', () => {
    assert.equal(shouldReplaceCliRuntime('/a', '/a', true), true)
    assert.equal(shouldReplaceCliRuntime(undefined, '/b', true), true)
  })

  it('replaces when there is no live process (drop the old resume cursor)', () => {
    assert.equal(shouldReplaceCliRuntime(undefined, '/b', false), true)
  })
})
