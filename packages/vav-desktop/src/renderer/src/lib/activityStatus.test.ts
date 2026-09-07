import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { windowActivityStatus } from './activityStatus.ts'

describe('windowActivityStatus', () => {
  it('running wins over an unseen completion', () => {
    assert.equal(
      windowActivityStatus({ turnRunning: true, ptyRunning: false, resultUnseen: true }),
      'running'
    )
    assert.equal(
      windowActivityStatus({ turnRunning: false, ptyRunning: true, resultUnseen: true }),
      'running'
    )
  })

  it('done is an unseen finish while idle', () => {
    assert.equal(
      windowActivityStatus({ turnRunning: false, ptyRunning: false, resultUnseen: true }),
      'done'
    )
  })

  it('idle when nothing is running and the result was seen', () => {
    assert.equal(
      windowActivityStatus({ turnRunning: false, ptyRunning: false, resultUnseen: false }),
      'idle'
    )
  })
})
