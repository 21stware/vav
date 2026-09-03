import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  checklistPlanFields,
  shouldFoldChecklistTool,
  skipEmptyChecklistUpdate
} from './cliChecklist.ts'

describe('shouldFoldChecklistTool', () => {
  it('folds plan/todo tools and skips enter-plan-mode', () => {
    assert.equal(shouldFoldChecklistTool('TodoWrite', 'plan'), true)
    assert.equal(shouldFoldChecklistTool('plan', 'plan'), true)
    assert.equal(shouldFoldChecklistTool('Bash', 'terminal'), false)
    assert.equal(shouldFoldChecklistTool('EnterPlanMode', 'switch_mode'), false)
  })
})

describe('skipEmptyChecklistUpdate', () => {
  it('drops completed empty checklists but keeps live updates', () => {
    assert.equal(skipEmptyChecklistUpdate(0, 'completed'), true)
    assert.equal(skipEmptyChecklistUpdate(0, 'started'), false)
    assert.equal(skipEmptyChecklistUpdate(2, 'completed'), false)
  })
})

describe('checklistPlanFields', () => {
  it('keeps a previous empty card and titles a live plan', () => {
    assert.deepEqual(checklistPlanFields('{"title":"Keep"}', { title: 'Plan', steps: [] }), {
      input: null,
      summary: null
    })
    const next = checklistPlanFields('{"title":"Keep","steps":[]}', {
      title: 'Plan',
      steps: [
        { status: 'done' },
        { status: 'pending' }
      ]
    })
    assert.deepEqual(next.input, {
      title: 'Keep',
      steps: [{ status: 'done' }, { status: 'pending' }]
    })
    assert.equal(next.summary, 'Plan · Keep (1/2)')
  })
})
