import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MessageBlock } from '../../shared/types.ts'
import {
  appendTurnErrorBlock,
  assistantSnapshotFromTurn,
  assistantStopKind,
  persistableTurnBlocks,
  runtimeTurnStatus,
  sealCancelledInteractiveTools,
  skipStableToolcallDelta
} from './agentTurnFinish.ts'

describe('skipStableToolcallDelta', () => {
  it('skips only toolcall deltas whose card summary did not change', () => {
    assert.equal(skipStableToolcallDelta('toolcall_delta', { summary: 'read' }, 'read'), true)
    assert.equal(skipStableToolcallDelta('toolcall_delta', { summary: 'read' }, 'write'), false)
    assert.equal(skipStableToolcallDelta('toolcall_delta', null, 'read'), false)
    assert.equal(skipStableToolcallDelta('toolcall', { summary: 'read' }, 'read'), false)
  })
})

describe('assistantStopKind', () => {
  it('maps aborted to cancelled and error to error', () => {
    assert.equal(assistantStopKind('aborted'), 'cancelled')
    assert.equal(assistantStopKind('error'), 'error')
    assert.equal(assistantStopKind('end_turn'), null)
    assert.equal(assistantStopKind(undefined), null)
  })
})

describe('persistableTurnBlocks', () => {
  it('keeps tools/plans and drops empty text/reasoning', () => {
    const blocks = persistableTurnBlocks([
      { kind: 'text', text: '' },
      { kind: 'text', text: 'hi' },
      { kind: 'reasoning', text: '' },
      { kind: 'toolCall', id: 't1', tool: 'fs_read', status: 'completed', summary: 'read' }
    ] as MessageBlock[])
    assert.equal(blocks.length, 2)
    assert.equal(blocks[0]?.kind, 'text')
    assert.equal(blocks[1]?.kind, 'toolCall')
  })
})

describe('assistantSnapshotFromTurn', () => {
  it('joins text blocks and stamps extras', () => {
    const snap = assistantSnapshotFromTurn(
      {
        messageId: 'm1',
        parentId: 'p1',
        blocks: [
          { kind: 'text', text: 'one' },
          { kind: 'text', text: 'two' }
        ]
      },
      { cancelled: true },
      42
    )
    assert.equal(snap.id, 'm1')
    assert.equal(snap.parentId, 'p1')
    assert.equal(snap.role, 'assistant')
    assert.equal(snap.content, 'one\ntwo')
    assert.equal(snap.createdAt, 42)
    assert.equal(snap.cancelled, true)
  })
})

describe('sealCancelledInteractiveTools / appendTurnErrorBlock', () => {
  it('skips pending ask/request and expires other in-flight tools', () => {
    const blocks: MessageBlock[] = [
      { kind: 'toolCall', id: 'a', tool: 'ask_user_question', status: 'pending', summary: 'q' },
      { kind: 'toolCall', id: 'p', tool: 'plan', status: 'executing', summary: 'plan' },
      { kind: 'toolCall', id: 'w', tool: 'fs_write', status: 'executing', summary: 'write' }
    ]
    sealCancelledInteractiveTools(blocks, 'Cancelled')
    assert.equal((blocks[0] as { status: string }).status, 'skipped')
    assert.equal((blocks[0] as { output?: string }).output, 'Cancelled')
    assert.equal((blocks[1] as { status: string }).status, 'executing')
    assert.equal((blocks[2] as { status: string }).status, 'expired')
  })

  it('quotes the error on its own line when blocks already exist', () => {
    const blocks: MessageBlock[] = [{ kind: 'text', text: 'hi' }]
    appendTurnErrorBlock(blocks, 'boom')
    assert.equal((blocks[1] as { text: string }).text, '\n\n> boom')
    const only: MessageBlock[] = []
    appendTurnErrorBlock(only, 'boom')
    assert.equal((only[0] as { text: string }).text, '> boom')
  })
})

describe('runtimeTurnStatus', () => {
  it('is idle with empty blocks when no turn is running', () => {
    const status = runtimeTurnStatus('c1', undefined)
    assert.equal(status.isRunning, false)
    assert.equal(status.phase, 'idle')
    assert.equal(status.awaitingToolCallId, null)
    assert.deepEqual(status.blocks, [])
  })

  it('snapshots in-flight blocks and the first pending tool', () => {
    const pending = new Map<string, unknown>([
      ['t1', {}],
      ['t2', {}]
    ])
    const status = runtimeTurnStatus('c1', {
      phase: 'working',
      toolCount: 2,
      pending,
      messageId: 'm1',
      blocks: [{ kind: 'text', text: 'hi' }]
    })
    assert.equal(status.isRunning, true)
    assert.equal(status.awaitingToolCallId, 't1')
    assert.equal(status.messageId, 'm1')
    assert.equal(status.blocks[0]?.kind, 'text')
  })
})
