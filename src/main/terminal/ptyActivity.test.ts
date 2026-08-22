import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ptyOutputImpliesRunning } from './ptyActivity.ts'

describe('ptyOutputImpliesRunning', () => {
  it('ignores bash echo (no agent id)', () => {
    assert.equal(ptyOutputImpliesRunning(null), false)
    assert.equal(ptyOutputImpliesRunning(undefined), false)
  })

  it('treats CLI agent / VAV-mirror output as work', () => {
    assert.equal(ptyOutputImpliesRunning('claude-code'), true)
    assert.equal(ptyOutputImpliesRunning('vav'), true)
  })
})
