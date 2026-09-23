import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseAppHostEvent } from './appHost.ts'

describe('parseAppHostEvent', () => {
  it('accepts open/create events and drops unknown kinds', () => {
    const event = parseAppHostEvent({
      type: 'open',
      url: 'vav://app/knowledge?id=n1',
      kind: 'knowledge'
    })
    assert.deepEqual(event, {
      type: 'open',
      url: 'vav://app/knowledge?id=n1',
      kind: 'knowledge'
    })
    assert.equal(parseAppHostEvent({ type: 'open', url: 'x', kind: 'notes' }), null)
    assert.equal(parseAppHostEvent(null), null)
  })
})
