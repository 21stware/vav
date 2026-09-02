import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MessageBlock } from '../../shared/types.ts'
import { en, zhCN } from '../../shared/i18n/index.ts'
import {
  extractUrlFromInput,
  findChecklistIndex,
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
})
