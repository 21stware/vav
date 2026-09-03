import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MessageBlock } from '../../shared/types.ts'
import { en, zhCN } from '../../shared/i18n/index.ts'
import {
  extractUrlFromInput,
  findChecklistIndex,
  cliHostTurnStatus,
  cliTurnParentId,
  isAskCancelText,
  isPlanDocRejectText,
  turnHasAnswerContent,
  turnHasIncompleteWork
} from './cliHostTurn.ts'

function tool(
  extra: Partial<Extract<MessageBlock, { kind: 'toolCall' }>> & { tool: Extract<MessageBlock, { kind: 'toolCall' }>['tool'] }
): Extract<MessageBlock, { kind: 'toolCall' }> {
  return {
    kind: 'toolCall',
    id: extra.id ?? 't1',
    tool: extra.tool,
    summary: extra.summary ?? '',
    input: extra.input ?? '{}',
    output: extra.output ?? '',
    status: extra.status ?? 'pending'
  }
}

describe('cliHostTurn', () => {
  it('treats tools or non-empty text as answer content', () => {
    assert.equal(turnHasAnswerContent([{ kind: 'text', text: '  ' }]), false)
    assert.equal(turnHasAnswerContent([{ kind: 'text', text: 'hi' }]), true)
    assert.equal(turnHasAnswerContent([{ kind: 'toolCall' }]), true)
    assert.equal(turnHasIncompleteWork([{ kind: 'toolCall', status: 'executing' }]), true)
    assert.equal(turnHasIncompleteWork([{ kind: 'toolCall', status: 'completed' }]), false)
  })

  it('reparents a user send and keeps the parent on regenerate', () => {
    const messages = [{ id: 'u1', role: 'user' }, { id: 'a1', role: 'assistant' }]
    assert.equal(cliTurnParentId('u1', 'leaf', messages), 'u1')
    assert.equal(cliTurnParentId('a1', 'u1', messages), 'u1')
  })

  it('finds the plan checklist and a URL on a tool_call', () => {
    const blocks: MessageBlock[] = [{ kind: 'text', text: 'x' }, tool({ tool: 'plan' })]
    assert.equal(findChecklistIndex(blocks), 1)
    assert.equal(
      extractUrlFromInput(
        tool({ tool: 'web_fetch', input: JSON.stringify({ url: ' https://ex.test ' }) })
      ),
      'https://ex.test'
    )
    assert.equal(extractUrlFromInput({ kind: 'text', text: 'no' }), null)
  })

  it('recognizes bilingual cancel / plan-doc reject lines', () => {
    assert.equal(isAskCancelText(en['common.cancel']), true)
    assert.equal(isAskCancelText(zhCN['common.cancel']), true)
    assert.equal(isAskCancelText('已取消'), true)
    assert.equal(isAskCancelText('keep going'), false)
    assert.equal(isPlanDocRejectText(en['planDoc.reject']), true)
    assert.equal(isPlanDocRejectText(zhCN['planDoc.reject']), true)
  })

  it('is idle with empty blocks when no CLI turn is running', () => {
    const status = cliHostTurnStatus('c1', undefined)
    assert.equal(status.isRunning, false)
    assert.equal(status.phase, 'idle')
    assert.equal(status.awaitingToolCallId, null)
    assert.deepEqual(status.blocks, [])
  })

  it('snapshots in-flight blocks and the first pending permission', () => {
    const pendingPermissions = new Map([
      ['r1', { toolCallId: 't1' }],
      ['r2', { toolCallId: 't2' }]
    ])
    const status = cliHostTurnStatus('c1', {
      phase: 'awaiting-user',
      toolCount: 2,
      pendingPermissions,
      messageId: 'm1',
      blocks: [{ kind: 'text', text: 'hi' }]
    })
    assert.equal(status.isRunning, true)
    assert.equal(status.awaitingToolCallId, 't1')
    assert.equal(status.messageId, 'm1')
    assert.equal(status.blocks[0]?.kind, 'text')
  })
})
