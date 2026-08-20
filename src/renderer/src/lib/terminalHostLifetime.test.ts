import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nextAttachGeneration, shouldParkDetachedHost } from './terminalHostLifetime.ts'

describe('terminal host lifetime', () => {
  it('parks only when the same generation is still detached', () => {
    const gen = nextAttachGeneration(0)
    assert.equal(shouldParkDetachedHost(gen, gen, false), true)
  })

  it('skips park when ⌘D re-claimed the xterm in the same turn', () => {
    const scheduled = 1
    const claimed = nextAttachGeneration(scheduled)
    assert.equal(shouldParkDetachedHost(scheduled, claimed, false), false)
  })

  it('skips park when the container is already back in the DOM', () => {
    assert.equal(shouldParkDetachedHost(2, 2, true), false)
  })
})
