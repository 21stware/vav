import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { StreamProjection } from './StreamProjection.ts'

describe('StreamProjection recovery', () => {
  let projection: StreamProjection

  afterEach(() => {
    projection?.end()
  })

  it('publishes reconnecting chrome immediately, then clears it on outputting', () => {
    projection = new StreamProjection()
    let publishes = 0
    projection.subscribe(() => {
      publishes += 1
    })
    projection.start()
    assert.equal(projection.getSnapshot().phase, 'thinking')
    assert.equal(projection.getSnapshot().recovery, null)

    const before = publishes
    projection.setPhase('reconnecting', { kind: 'reconnecting', attempt: 1, limit: 3 })
    assert.equal(publishes, before + 1)
    assert.equal(projection.getSnapshot().phase, 'reconnecting')
    assert.deepEqual(projection.getSnapshot().recovery, {
      kind: 'reconnecting',
      attempt: 1,
      limit: 3
    })

    projection.setPhase('reconnecting', { kind: 'reconnecting', attempt: 1, limit: 3 })
    assert.equal(publishes, before + 1)

    projection.setPhase('outputting', null)
    assert.equal(projection.getSnapshot().phase, 'outputting')
    assert.equal(projection.getSnapshot().recovery, null)
  })

  it('hydrates a late window with healing chrome and the partial draft', () => {
    projection = new StreamProjection()
    projection.hydrate(
      'healing',
      [{ kind: 'text', text: 'partial e2e reply' }],
      { kind: 'healing', attempt: 1, limit: 3 }
    )
    const snap = projection.getSnapshot()
    assert.equal(snap.active, true)
    assert.equal(snap.phase, 'healing')
    assert.deepEqual(snap.recovery, { kind: 'healing', attempt: 1, limit: 3 })
    assert.equal(snap.blocks.length, 1)
    assert.equal(snap.blocks[0]?.kind, 'text')
  })

  it('start wipes a previous recovery so a new turn does not inherit chrome', () => {
    projection = new StreamProjection()
    projection.setPhase('retrying', { kind: 'retrying', attempt: 2, limit: 3 })
    projection.start()
    assert.equal(projection.getSnapshot().phase, 'thinking')
    assert.equal(projection.getSnapshot().recovery, null)
  })

  it('end drops live recovery so the sealed transcript takes over', () => {
    projection = new StreamProjection()
    projection.start()
    projection.setPhase('retrying', { kind: 'retrying', attempt: 1, limit: 3 })
    projection.end()
    const snap = projection.getSnapshot()
    assert.equal(snap.active, false)
    assert.equal(snap.phase, 'idle')
    assert.equal(snap.recovery, null)
  })
})
