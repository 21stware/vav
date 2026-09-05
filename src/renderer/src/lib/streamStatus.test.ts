import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { streamStatusLabel, streamStatusState } from './streamStatus.ts'

const labels = {
  outputting: 'Outputting',
  retry: 'Retrying',
  reconnect: 'Reconnecting',
  heal: 'Recovering',
  progress: (label: string, attempt: number, limit: number) => `${label} ${attempt}/${limit}`
}

describe('streamStatusState', () => {
  it('maps recovery phases onto the stream chrome', () => {
    assert.equal(streamStatusState('outputting'), 'outputting')
    assert.equal(streamStatusState('thinking'), 'outputting')
    assert.equal(streamStatusState('retrying'), 'retrying')
    assert.equal(streamStatusState('reconnecting'), 'reconnecting')
    assert.equal(streamStatusState('healing'), 'healing')
  })
})

describe('streamStatusLabel', () => {
  it('shows graduated retry progress for retrying and reconnecting', () => {
    assert.equal(streamStatusLabel('outputting', labels), 'Outputting')
    assert.equal(
      streamStatusLabel('retrying', labels, { kind: 'retrying', attempt: 2, limit: 3 }),
      'Retrying 2/3'
    )
    assert.equal(
      streamStatusLabel('reconnecting', labels, { kind: 'reconnecting', attempt: 1, limit: 3 }),
      'Reconnecting 1/3'
    )
    assert.equal(
      streamStatusLabel('healing', labels, { kind: 'healing', attempt: 1, limit: 3 }),
      'Recovering'
    )
  })
})
