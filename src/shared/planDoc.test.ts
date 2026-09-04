import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeAskQuestions } from './askPlan.ts'
import {
  acpPlanEntriesToSteps,
  cursorAskOutcomeFromAnswer,
  cursorAskToToolInput,
  grokAskOutcomeFromAnswer,
  grokPlanOutcomeFromAnswer,
  isAskToolName,
  isChecklistToolName,
  isEnterPlanModeName,
  isPlanDocToolName,
  isTodoUpdateToolName,
  mergeTodos,
  normalizeCursorAskInput,
  normalizePlanDocInput,
  planDocHasBody,
  planDocSummary,
  projectChecklistInput,
  todosToSteps
} from './planDoc.ts'

describe('isPlanDocToolName', () => {
  it('matches plan documents, not checklists', () => {
    assert.equal(isPlanDocToolName('createPlan'), true)
    assert.equal(isPlanDocToolName('create_plan'), true)
    assert.equal(isPlanDocToolName('cursor/create_plan'), true)
    assert.equal(isPlanDocToolName('ExitPlanMode'), true)
    assert.equal(isPlanDocToolName('_x.ai/exit_plan_mode'), true)
    assert.equal(isPlanDocToolName('proposed_plan'), true)
    assert.equal(isPlanDocToolName('plan'), false)
    assert.equal(isPlanDocToolName('todo_write'), false)
    assert.equal(isPlanDocToolName('update_plan'), false)
    assert.equal(isPlanDocToolName('EnterPlanMode'), false)
  })
})

describe('host tool names', () => {
  it('classifies ask / enter-plan / checklist names', () => {
    assert.equal(isAskToolName('AskUserQuestion'), true)
    assert.equal(isAskToolName('question'), true)
    assert.equal(isEnterPlanModeName('EnterPlanMode'), true)
    assert.equal(isChecklistToolName('TodoWrite'), true)
    assert.equal(isChecklistToolName('update_plan'), true)
    assert.equal(isChecklistToolName('createPlan'), false)
  })
})

describe('projectChecklistInput', () => {
  it('reads Claude todos and Codex plan arrays', () => {
    const claude = projectChecklistInput({
      todos: [{ content: 'Read files', status: 'completed' }]
    })
    assert.equal(claude.steps[0]?.title, 'Read files')
    assert.equal(claude.steps[0]?.status, 'done')
    const codex = projectChecklistInput({
      explanation: 'Next',
      plan: [{ step: 'Patch', status: 'in_progress' }]
    })
    assert.equal(codex.title, 'Next')
    assert.equal(codex.steps[0]?.title, 'Patch')
    assert.equal(codex.steps[0]?.status, 'executing')
  })

  it('reads completed booleans and items[] used by some CLI hosts', () => {
    const fromFlag = projectChecklistInput({
      items: [
        { text: 'One', completed: true },
        { text: 'Two', completed: false }
      ]
    })
    assert.equal(fromFlag.steps[0]?.status, 'done')
    assert.equal(fromFlag.steps[1]?.status, 'pending')
    const fromJson = projectChecklistInput(
      JSON.stringify({ todos: [{ content: 'Ship', status: 'completed' }] })
    )
    assert.equal(fromJson.steps[0]?.title, 'Ship')
    assert.equal(fromJson.steps[0]?.status, 'done')
  })
})

describe('isTodoUpdateToolName', () => {
  it('matches Cursor todo notifications', () => {
    assert.equal(isTodoUpdateToolName('update_todos'), true)
    assert.equal(isTodoUpdateToolName('cursor/update_todos'), true)
    assert.equal(isTodoUpdateToolName('createPlan'), false)
  })
})

describe('normalizePlanDocInput', () => {
  it('reads Cursor create_plan payload', () => {
    const doc = normalizePlanDocInput({
      name: 'Refactor tabs',
      overview: 'Tighten layout.',
      plan: '# Steps\n\nInspect sizing.',
      todos: [{ id: 't1', content: 'Inspect', status: 'in_progress' }]
    })
    assert.equal(doc.name, 'Refactor tabs')
    assert.equal(doc.overview, 'Tighten layout.')
    assert.match(doc.plan, /Inspect sizing/)
    assert.equal(doc.todos[0]?.title, 'Inspect')
    assert.equal(doc.todos[0]?.status, 'executing')
    assert.equal(planDocHasBody(doc), true)
    assert.equal(planDocSummary(doc), 'Tighten layout.')
  })

  it('does not treat a stub _toolName payload as a body', () => {
    const doc = normalizePlanDocInput({ _toolName: 'createPlan' })
    assert.equal(planDocHasBody(doc), false)
    assert.equal(doc.name, 'Plan')
  })

  it('reads Grok exit_plan_mode planContent', () => {
    const doc = normalizePlanDocInput({
      planContent: '# Ship\n\nWrite hello.txt',
      name: 'Ship'
    })
    assert.match(doc.plan, /hello.txt/)
    assert.equal(planDocHasBody(doc), true)
  })
})

describe('grok ask / plan outcomes', () => {
  it('keys answers by question text', () => {
    const ask = normalizeCursorAskInput({
      questions: [
        {
          question: 'Which colour should the banner be?',
          options: [{ label: 'Red' }, { label: 'Blue' }]
        }
      ]
    })
    const outcome = grokAskOutcomeFromAnswer(
      ask,
      JSON.stringify({ answers: [{ questionIndex: 0, value: 'Red' }] })
    )
    assert.deepEqual(outcome, {
      outcome: 'accepted',
      answers: { 'Which colour should the banner be?': 'Red' }
    })
    assert.deepEqual(grokAskOutcomeFromAnswer(ask, 'cancel'), { outcome: 'skip_interview' })
    assert.deepEqual(grokPlanOutcomeFromAnswer('', false), { outcome: 'accepted' })
    assert.deepEqual(grokPlanOutcomeFromAnswer('too risky', true), {
      outcome: 'rejected',
      reason: 'too risky'
    })
  })
})

describe('todosToSteps / acpPlanEntriesToSteps', () => {
  it('maps ACP plan entries onto checklist steps', () => {
    const steps = acpPlanEntriesToSteps([
      { content: 'Read files', status: 'completed' },
      { content: 'Write patch', status: 'in_progress' },
      { content: 'Verify', status: 'pending' }
    ])
    assert.deepEqual(
      steps.map((step) => [step.title, step.status]),
      [
        ['Read files', 'done'],
        ['Write patch', 'executing'],
        ['Verify', 'pending']
      ]
    )
  })
})

describe('mergeTodos', () => {
  it('replaces when asked, otherwise merges by id', () => {
    const current = todosToSteps([
      { id: 'a', content: 'A', status: 'pending' },
      { id: 'b', content: 'B', status: 'pending' }
    ])
    const incoming = todosToSteps([{ id: 'a', content: 'A2', status: 'completed' }])
    const merged = mergeTodos(current, incoming, false)
    assert.equal(merged[0]?.title, 'A2')
    assert.equal(merged[0]?.status, 'done')
    assert.equal(merged[1]?.id, 'b')
    const replaced = mergeTodos(current, incoming, true)
    assert.equal(replaced.length, 1)
    assert.equal(replaced[0]?.id, 'a')
  })
})

describe('normalizeCursorAskInput', () => {
  it('rebuilds AskCard questions from Cursor options', () => {
    const ask = normalizeCursorAskInput({
      title: 'Need input',
      questions: [
        {
          id: 'q1',
          prompt: 'Which mode?',
          options: [
            { id: 'agent', label: 'Agent' },
            { id: 'plan', label: 'Plan' }
          ]
        }
      ]
    })
    const questions = normalizeAskQuestions(cursorAskToToolInput(ask))
    assert.equal(questions[0]?.question, 'Which mode?')
    assert.deepEqual(questions[0]?.choices, ['Agent', 'Plan'])
    const outcome = cursorAskOutcomeFromAnswer(
      ask,
      JSON.stringify({ answers: [{ questionIndex: 0, value: 'Plan' }] })
    )
    assert.deepEqual(outcome, {
      outcome: 'answered',
      answers: [{ questionId: 'q1', selectedOptionIds: ['plan'] }]
    })
  })
})
