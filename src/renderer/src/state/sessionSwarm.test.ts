import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setLeaf } from './sessionSwarm.ts'

describe('setLeaf', () => {
  it('patches one conversation leaf without dropping the others', () => {
    let next: { activeLeaf: Record<string, string | null> } | null = null
    setLeaf(
      (partial) => {
        next = partial
      },
      { a: 'leaf-a', b: 'leaf-b' },
      'a',
      'leaf-a2'
    )
    assert.deepEqual(next, { activeLeaf: { a: 'leaf-a2', b: 'leaf-b' } })
  })
})
