import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MessageBlock } from '../../shared/types.ts'
import { allocateCliDeltaSlot } from './cliDelta.ts'

function turn(extra?: Partial<{ toolCount: number; blocks: MessageBlock[] }>) {
  return {
    textIndex: null as number | null,
    reasoningIndex: null as number | null,
    blocks: (extra?.blocks ?? []) as MessageBlock[],
    reasoningStartedAt: new Map<number, number>(),
    toolCount: extra?.toolCount ?? 0
  }
}

describe('allocateCliDeltaSlot', () => {
  it('opens a text slot and seals reasoning first', () => {
    let sealed = 0
    const t = turn()
    const index = allocateCliDeltaSlot(t, 'text', () => {
      sealed += 1
    }, 9)
    assert.equal(index, 0)
    assert.equal(sealed, 1)
    assert.equal(t.textIndex, 0)
    assert.equal(t.blocks[0]?.kind, 'text')
  })

  it('reuses the live text slot', () => {
    const t = turn()
    allocateCliDeltaSlot(t, 'text', () => {}, 9)
    const again = allocateCliDeltaSlot(t, 'text', () => {}, 9)
    assert.equal(again, 0)
    assert.equal(t.blocks.length, 1)
  })

  it('stamps reasoning start without sealing', () => {
    let sealed = 0
    const t = turn()
    const index = allocateCliDeltaSlot(t, 'reasoning', () => {
      sealed += 1
    }, 42)
    assert.equal(index, 0)
    assert.equal(sealed, 0)
    assert.equal(t.reasoningStartedAt.get(0), 42)
  })

  it('starts a fresh text block after tools', () => {
    const t = turn({
      toolCount: 1,
      blocks: [{ kind: 'toolCall', id: 't1', tool: 'fs_read', status: 'completed', summary: 'read' }]
    })
    t.textIndex = 0
    const index = allocateCliDeltaSlot(t, 'text', () => {}, 9)
    assert.equal(index, 1)
    assert.equal(t.blocks[1]?.kind, 'text')
    assert.equal(t.textIndex, 1)
  })
})
