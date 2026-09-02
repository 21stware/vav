import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyToolEventStatus,
  applyToolRuntimePatch,
  newCliToolCallBlock,
  shouldKeepPendingInteractive
} from './cliToolBlock.ts'

describe('cliToolBlock', () => {
  it('creates a pending tool card', () => {
    const block = newCliToolCallBlock({
      id: 't1',
      tool: 'fs_read',
      summary: 'read',
      input: '{}'
    })
    assert.equal(block.kind, 'toolCall')
    assert.equal(block.status, 'pending')
    assert.equal(block.output, '')
  })

  it('keeps parked ask/plan-doc pending, then completes others', () => {
    const ask = newCliToolCallBlock({
      id: 'a',
      tool: 'ask_user_question',
      summary: 'q',
      input: '{}'
    })
    assert.equal(shouldKeepPendingInteractive(ask), true)
    applyToolEventStatus(ask, 'started')
    assert.equal(ask.status, 'pending')
    const read = newCliToolCallBlock({
      id: 'r',
      tool: 'fs_read',
      summary: 'read',
      input: '{}'
    })
    applyToolEventStatus(read, 'started')
    assert.equal(read.status, 'executing')
    applyToolEventStatus(read, 'completed', 'ok')
    assert.equal(read.status, 'completed')
    assert.equal(read.output, 'ok')
  })

  it('attaches optional nested/interactive fields', () => {
    const block = newCliToolCallBlock({
      id: 'p',
      tool: 'task',
      summary: 'task',
      input: '{}',
      status: 'executing',
      children: [],
      questions: [{ question: 'q?' }],
      askTitle: 'Ask',
      choices: ['a', 'b']
    })
    assert.equal(block.status, 'executing')
    assert.deepEqual(block.children, [])
    assert.equal(block.askTitle, 'Ask')
    assert.deepEqual(block.choices, ['a', 'b'])
    assert.equal(block.questions?.[0]?.question, 'q?')
  })

  it('clears approval fields when the runtime patch has no choices', () => {
    const prev = newCliToolCallBlock({
      id: 't',
      tool: 'fs_write',
      summary: 'write',
      input: '{}',
      choices: ['Approve', 'Deny'],
      askTitle: 'fs_write'
    })
    const next = applyToolRuntimePatch(prev, { status: 'executing', output: 'ok' })
    assert.equal(next.status, 'executing')
    assert.equal(next.output, 'ok')
    assert.equal(next.choices, undefined)
    assert.equal(next.askTitle, undefined)
  })
})
