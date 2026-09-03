import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MessageBlock } from '../../shared/types.ts'
import { planSealMode, sealCliPlanBlocks, sealRuntimePlanBlocks } from './planSeal.ts'

const labels = { cancelled: 'Cancelled', failed: 'Failed' }

function plan(input: string): Extract<MessageBlock, { kind: 'toolCall' }> {
  return {
    kind: 'toolCall',
    id: 'p1',
    tool: 'plan',
    summary: '',
    input,
    output: '',
    status: 'executing'
  }
}

describe('planSealMode', () => {
  it('prefers cancel, then error, then success', () => {
    assert.equal(planSealMode(true, 'boom'), 'cancel')
    assert.equal(planSealMode(false, 'boom'), 'error')
    assert.equal(planSealMode(false, ''), 'success')
    assert.equal(planSealMode(false, null), 'success')
    assert.equal(planSealMode(false), 'success')
  })
})

describe('planSeal', () => {
  it('marks leftover builtin steps done and pretty-prints the checklist', () => {
    const block = plan(
      JSON.stringify({
        title: '',
        steps: [{ id: '1', title: 'Ship', status: 'pending' }]
      })
    )
    sealRuntimePlanBlocks([block], 'success', labels)
    assert.equal(block.status, 'completed')
    assert.match(block.summary, /Plan · Plan \(1\/1\)/)
    const parsed = JSON.parse(block.input) as { title: string; steps: Array<{ status: string }> }
    assert.equal(parsed.title, 'Plan')
    assert.equal(parsed.steps[0]?.status, 'done')
    assert.match(block.input, /\n/)
  })

  it('skips empty CLI checklists and writes compact JSON', () => {
    const empty = plan('{}')
    sealCliPlanBlocks([empty], 'success', labels)
    assert.equal(empty.status, 'executing')
    const live = plan(
      JSON.stringify({
        title: 'Ship',
        steps: [{ id: '1', title: 'Do', status: 'executing' }]
      })
    )
    sealCliPlanBlocks([live], 'cancel', labels)
    assert.equal(live.status, 'completed')
    assert.equal(JSON.parse(live.input).steps[0].status, 'error')
    assert.equal(live.input.includes('\n'), false)
  })
})
