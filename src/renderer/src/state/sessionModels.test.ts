import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nextSteppedModelId } from './sessionModels.ts'

describe('nextSteppedModelId', () => {
  it('wraps, falls back to the first id, and no-ops a singleton', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    assert.equal(nextSteppedModelId(list, 'b', 1), 'c')
    assert.equal(nextSteppedModelId(list, 'c', 1), 'a')
    assert.equal(nextSteppedModelId(list, 'a', -1), 'c')
    assert.equal(nextSteppedModelId(list, 'missing', 1), 'a')
    assert.equal(nextSteppedModelId([{ id: 'only' }], 'only', 1), null)
    assert.equal(nextSteppedModelId([], 'a', 1), null)
  })
})
