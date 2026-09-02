import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MessageBlock } from '../../shared/types.ts'
import {
  applyCliCancelQuota,
  cliAssistantContent,
  cliAssistantMessage,
  sameSessionRetryPlan,
  shouldSettleAsCancelled,
  stripLeakedStreamErrorFromTurn
} from './cliTurnFinish.ts'

describe('shouldSettleAsCancelled', () => {
  it('settles when the turn was already cancelled or the error is a cancel', () => {
    assert.equal(shouldSettleAsCancelled(true, 'boom'), true)
    assert.equal(shouldSettleAsCancelled(false, 'Request cancelled'), true)
    assert.equal(shouldSettleAsCancelled(false, 'network timeout'), false)
  })
})

describe('sameSessionRetryPlan', () => {
  it('continues without re-prompt when partial answer content already landed', () => {
    assert.deepEqual(sameSessionRetryPlan(true), {
      phase: 'retrying',
      prepareReplayFromBlocks: true,
      continueWithoutReprompt: true
    })
  })

  it('re-opens replay and re-prompts when the turn has no answer yet', () => {
    assert.deepEqual(sameSessionRetryPlan(false), {
      phase: 'thinking',
      prepareReplayFromBlocks: false,
      continueWithoutReprompt: false
    })
  })
})

describe('cliAssistantContent', () => {
  it('joins text with blank lines and trims', () => {
    assert.equal(
      cliAssistantContent([
        { kind: 'text', text: 'one' },
        { kind: 'reasoning', text: 'think' },
        { kind: 'text', text: 'two' }
      ] as MessageBlock[]),
      'one\n\ntwo'
    )
    assert.equal(cliAssistantContent([{ kind: 'text', text: '  hi  ' }]), 'hi')
  })
})

describe('applyCliCancelQuota', () => {
  it('clears a cancelled generic error', () => {
    const turn = { cancelled: true, error: 'boom', errorKind: 'generic', errorDetail: 'x' }
    applyCliCancelQuota(turn)
    assert.equal(turn.cancelled, true)
    assert.equal(turn.error, undefined)
    assert.equal(turn.errorKind, undefined)
    assert.equal(turn.errorDetail, undefined)
  })

  it('keeps quota errors and unsets cancelled', () => {
    const turn = {
      cancelled: true,
      error: 'usage limit exceeded',
      errorCode: 429,
      errorKind: 'quota',
      errorDetail: 'limit'
    }
    applyCliCancelQuota(turn)
    assert.equal(turn.cancelled, false)
    assert.equal(turn.error, 'usage limit exceeded')
  })
})

describe('cliAssistantMessage', () => {
  it('stamps content and extras', () => {
    const msg = cliAssistantMessage(
      {
        messageId: 'm1',
        parentId: 'p1',
        blocks: [{ kind: 'text', text: 'hi' }],
        cancelled: true,
        error: undefined
      },
      9
    )
    assert.equal(msg.id, 'm1')
    assert.equal(msg.content, 'hi')
    assert.equal(msg.createdAt, 9)
    assert.equal(msg.cancelled, true)
  })
})

describe('stripLeakedStreamErrorFromTurn', () => {
  it('is a no-op without a leaked trailer', () => {
    const turn = { blocks: [{ kind: 'text', text: 'hello' }] as MessageBlock[], textIndex: 0 }
    const out = stripLeakedStreamErrorFromTurn(turn)
    assert.equal(out.leaked, null)
    assert.equal(turn.blocks[0]?.kind === 'text' ? turn.blocks[0].text : '', 'hello')
  })

  it('keeps the reply and reports the leaked tail', () => {
    const turn = {
      blocks: [
        { kind: 'text', text: 'PONG\n\nError: RetriableError: WritableIterable is closed' }
      ] as MessageBlock[],
      textIndex: 0
    }
    const out = stripLeakedStreamErrorFromTurn(turn)
    assert.match(out.leaked ?? '', /WritableIterable is closed/)
    assert.equal(out.replaceText, 'PONG')
    assert.equal(turn.blocks[0]?.kind === 'text' ? turn.blocks[0].text : '', 'PONG')
  })

  it('pops a reply that was only the leak', () => {
    const turn = {
      blocks: [{ kind: 'text', text: 'Error: RetriableError: WritableIterable is closed' }] as MessageBlock[],
      textIndex: 0
    }
    const out = stripLeakedStreamErrorFromTurn(turn)
    assert.ok(out.leaked)
    assert.equal(out.replaceText, '')
    assert.equal(turn.blocks.length, 0)
    assert.equal(turn.textIndex, null)
  })
})
