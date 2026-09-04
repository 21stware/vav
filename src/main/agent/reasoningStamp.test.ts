import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MessageBlock } from '../../shared/types.ts'
import { stampReasoningDurations } from './reasoningStamp.ts'

describe('stampReasoningDurations', () => {
  it('stamps open reasoning slots from first-token times', () => {
    const blocks: MessageBlock[] = [
      { kind: 'text', text: 'hi' },
      { kind: 'reasoning', text: 'think' }
    ]
    const started = new Map<number, number>([[1, 1000]])
    stampReasoningDurations(blocks, started, 1250)
    assert.equal(blocks[1] && 'durationMs' in blocks[1] ? blocks[1].durationMs : 0, 250)
  })

  it('does not overwrite an already sealed duration', () => {
    const blocks: MessageBlock[] = [{ kind: 'reasoning', text: 'think', durationMs: 10 }]
    stampReasoningDurations(blocks, new Map([[0, 0]]), 999)
    assert.equal(blocks[0] && 'durationMs' in blocks[0] ? blocks[0].durationMs : 0, 10)
  })
})
