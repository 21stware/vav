import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isChildAlive } from './process.ts'

describe('isChildAlive', () => {
  it('treats a process as alive until exitCode or signalCode is set', () => {
    assert.equal(isChildAlive({ exitCode: null, signalCode: null }), true)
    assert.equal(isChildAlive({ exitCode: 0, signalCode: null }), false)
    assert.equal(isChildAlive({ exitCode: null, signalCode: 'SIGKILL' }), false)
    assert.equal(isChildAlive({}), true)
  })
})
