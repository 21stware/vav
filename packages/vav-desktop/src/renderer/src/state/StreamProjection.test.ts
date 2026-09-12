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

  it('folds reasoning snapshots instead of reprinting them', async () => {
    projection = new StreamProjection()
    projection.start()
    projection.appendReasoning(0, '用户要求操作日历至12月。')
    const later =
      '正在检查工作区环境、浏览器自动化技能及历史记录，确定如何操作日历。用户要求操作日历至12月份。'
    projection.appendReasoning(0, later)
    projection.appendReasoning(0, later)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const block = projection.getSnapshot().blocks[0]
    assert.equal(block?.kind, 'reasoning')
    if (block?.kind === 'reasoning') assert.equal(block.text, later)
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
