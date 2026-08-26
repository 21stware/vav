/**
 * Shared projection for a reviewable plan document.
 *
 * Distinct from VAV `plan` (the live execution checklist). Cursor
 * `createPlan` / `cursor/create_plan` and similar host tools write a markdown
 * document the user accepts or rejects — they are not todos.
 */
import type { AskQuestion, PlanStep, PlanStepStatus } from './types'

function toolKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function isPlanDocToolName(raw: string): boolean {
  const n = toolKey(raw)
  return (
    n === 'createplan' ||
    n.endsWith('createplan') ||
    n === 'exitplanmode' ||
    n === 'exitplan' ||
    n === 'proposedplan' ||
    n === 'proposed_plan'
  )
}

export function isEnterPlanModeName(raw: string): boolean {
  const n = toolKey(raw)
  return n === 'enterplanmode' || n === 'enterplan'
}

export function isAskToolName(raw: string): boolean {
  const n = toolKey(raw)
  return n.includes('ask') || n === 'question'
}

export function isChecklistToolName(raw: string): boolean {
  const n = toolKey(raw)
  return (
    n === 'todowrite' ||
    n === 'todoread' ||
    n === 'todo' ||
    n === 'plan' ||
    n === 'updateplan' ||
    n === 'todolist' ||
    isTodoUpdateToolName(raw)
  )
}

export function isTodoUpdateToolName(raw: string): boolean {
  const n = toolKey(raw)
  return n === 'updatetodos' || n === 'cursorupdatetodos' || n.endsWith('updatetodos')
}

/** Host-agnostic checklist: Claude todos, Codex plan[], ACP entries, VAV steps. */
export function projectChecklistInput(raw: unknown): { title: string; steps: PlanStep[] } {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      value = {}
    }
  }
  const rec =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  let steps = todosToSteps(rec.steps)
  if (!steps.length) steps = todosToSteps(rec.todos)
  if (!steps.length) steps = todosToSteps(rec.plan)
  if (!steps.length) steps = todosToSteps(rec.entries)
  if (!steps.length) steps = todosToSteps(rec.items)
  if (!steps.length && Array.isArray(value)) steps = todosToSteps(value)
  const title = String(rec.title ?? rec.name ?? rec.explanation ?? '').trim() || 'Plan'
  return { title, steps }
}

export type PlanDocInput = {
  name: string
  overview?: string
  plan: string
  todos: PlanStep[]
  isProject?: boolean
  phases?: Array<{ name: string; todos: PlanStep[] }>
}

const TODO_STATUS: Record<string, PlanStepStatus> = {
  pending: 'pending',
  executing: 'executing',
  in_progress: 'executing',
  inprogress: 'executing',
  done: 'done',
  completed: 'done',
  complete: 'done',
  finished: 'done',
  success: 'done',
  working: 'executing',
  started: 'executing',
  progress: 'executing',
  error: 'error',
  skipped: 'skipped',
  cancelled: 'skipped',
  canceled: 'skipped'
}

export function todoStatusFrom(raw: unknown): PlanStepStatus {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return TODO_STATUS[key] ?? 'pending'
}

function stepStatusFromRow(row: Record<string, unknown>): PlanStepStatus {
  const key = String(row.status ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (key && TODO_STATUS[key]) return TODO_STATUS[key]!
  if (
    row.completed === true ||
    row.done === true ||
    row.isCompleted === true ||
    row.is_completed === true
  ) {
    return 'done'
  }
  if (row.active === true || row.inProgress === true || row.in_progress === true) {
    return 'executing'
  }
  return 'pending'
}

export function todosToSteps(raw: unknown): PlanStep[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item, index) => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    return {
      id: String(row.id ?? `step-${index}`),
      title:
        String(row.title ?? row.content ?? row.step ?? row.text ?? `Step ${index + 1}`).trim() ||
        `Step ${index + 1}`,
      status: stepStatusFromRow(row),
      subtitle: row.subtitle != null ? String(row.subtitle) : undefined
    }
  })
}

export function sealPlanSteps(
  steps: PlanStep[],
  mode: 'cancel' | 'error' | 'success',
  labels?: { cancelled?: string; failed?: string }
): PlanStep[] {
  return steps.map((step) => {
    if (mode === 'cancel') {
      if (step.status === 'executing') {
        return { ...step, status: 'error' as const, subtitle: step.subtitle ?? labels?.cancelled }
      }
      if (step.status === 'pending') {
        return { ...step, status: 'skipped' as const, subtitle: step.subtitle ?? labels?.cancelled }
      }
      return step
    }
    if (mode === 'error') {
      if (step.status === 'executing') {
        return { ...step, status: 'error' as const, subtitle: step.subtitle ?? labels?.failed }
      }
      return step
    }
    if (step.status === 'executing' || step.status === 'pending') {
      return { ...step, status: 'done' as const }
    }
    return step
  })
}

/** Keep current order for existing ids; append new incoming ids. */
export function mergeTodos(current: PlanStep[], incoming: PlanStep[], replace: boolean): PlanStep[] {
  if (replace || current.length === 0) return incoming
  const byId = new Map(current.map((step) => [step.id, step]))
  for (const step of incoming) byId.set(step.id, step)
  const seen = new Set<string>()
  const out: PlanStep[] = []
  for (const step of current) {
    const next = byId.get(step.id)
    if (!next || seen.has(step.id)) continue
    out.push(next)
    seen.add(step.id)
  }
  for (const step of incoming) {
    if (seen.has(step.id)) continue
    out.push(step)
    seen.add(step.id)
  }
  return out
}

export function normalizePlanDocInput(raw: unknown): PlanDocInput {
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const nested =
    rec.plan && typeof rec.plan === 'object' && !Array.isArray(rec.plan)
      ? (rec.plan as Record<string, unknown>)
      : null
  const src = nested ?? rec
  const name = String(src.name ?? rec.name ?? src.title ?? rec.title ?? '').trim()
  const overview = String(src.overview ?? rec.overview ?? '').trim()
  const planText =
    typeof src.plan === 'string'
      ? src.plan
      : typeof rec.plan === 'string'
        ? rec.plan
        : String(src.body ?? rec.body ?? src.text ?? rec.text ?? '').trim()
  const phaseRows = Array.isArray(src.phases) ? src.phases : Array.isArray(rec.phases) ? rec.phases : []
  const phases = phaseRows
    .map((item) => {
      const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      const phaseName = String(row.name ?? '').trim()
      const steps = todosToSteps(row.todos)
      if (!phaseName && steps.length === 0) return null
      return { name: phaseName || 'Phase', todos: steps }
    })
    .filter((row): row is { name: string; todos: PlanStep[] } => row != null)
  const todos = todosToSteps(src.todos ?? rec.todos)
  const fromPhases = phases.flatMap((phase) => phase.todos)
  return {
    name: name || 'Plan',
    overview: overview || undefined,
    plan: planText.trim(),
    todos: todos.length ? todos : fromPhases,
    isProject: src.isProject === true || rec.isProject === true,
    phases: phases.length ? phases : undefined
  }
}

export function planDocHasBody(doc: PlanDocInput): boolean {
  return Boolean(doc.plan || doc.overview || doc.todos.length)
}

export function planDocSummary(doc: PlanDocInput): string {
  if (doc.overview) return doc.overview
  if (doc.plan) {
    const line = doc.plan
      .split('\n')
      .map((part) => part.replace(/^#+\s*/, '').trim())
      .find(Boolean)
    if (line) return line
  }
  return doc.name
}

export function planDocToChecklistInput(doc: PlanDocInput): { title: string; steps: PlanStep[] } {
  return { title: doc.name, steps: doc.todos }
}

/** ACP `sessionUpdate: plan` entries → VAV checklist steps. */
export function acpPlanEntriesToSteps(raw: unknown): PlanStep[] {
  return todosToSteps(raw)
}

export type CursorAskOption = { id: string; label: string }

export type CursorAskQuestion = {
  id: string
  prompt: string
  options: CursorAskOption[]
  allowMultiple?: boolean
}

export type CursorAskInput = {
  title?: string
  questions: CursorAskQuestion[]
}

export function normalizeCursorAskInput(raw: unknown): CursorAskInput {
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const rows = Array.isArray(rec.questions) ? rec.questions : []
  const questions: CursorAskQuestion[] = []
  for (const [index, item] of rows.entries()) {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const prompt = String(row.prompt ?? row.question ?? '').trim()
    if (!prompt) continue
    const optionsRaw = Array.isArray(row.options) ? row.options : []
    const options: CursorAskOption[] = []
    for (const [optIndex, opt] of optionsRaw.entries()) {
      if (typeof opt === 'string') {
        const label = opt.trim()
        if (label) options.push({ id: `opt-${optIndex}`, label })
        continue
      }
      const recOpt = (opt && typeof opt === 'object' ? opt : {}) as Record<string, unknown>
      const label = String(recOpt.label ?? recOpt.value ?? '').trim()
      if (!label) continue
      options.push({
        id: String(recOpt.id ?? `opt-${optIndex}`),
        label
      })
    }
    questions.push({
      id: String(row.id ?? `q-${index}`),
      prompt,
      options,
      allowMultiple: row.allowMultiple === true || row.multiSelect === true
    })
  }
  const title = String(rec.title ?? '').trim()
  return { title: title || undefined, questions }
}

/** Persist a shape `normalizeAskQuestions` can rebuild, plus Cursor option ids. */
export function cursorAskToToolInput(ask: CursorAskInput): Record<string, unknown> {
  return {
    title: ask.title,
    questions: ask.questions.map((question) => ({
      id: question.id,
      question: question.prompt,
      prompt: question.prompt,
      choices: question.options.map((option) => option.label),
      options: question.options,
      multiSelect: question.allowMultiple === true,
      allowMultiple: question.allowMultiple === true
    }))
  }
}

export function cursorAskQuestions(ask: CursorAskInput): AskQuestion[] {
  return ask.questions.map((question) => ({
    question: question.prompt,
    choices: question.options.length ? question.options.map((option) => option.label) : undefined,
    multiSelect: question.allowMultiple === true
  }))
}

export type CursorAskOutcome =
  | {
      outcome: 'answered'
      answers: Array<{ questionId: string; selectedOptionIds: string[] }>
    }
  | { outcome: 'skipped'; reason?: string }
  | { outcome: 'cancelled' }

export function cursorAskOutcomeFromAnswer(ask: CursorAskInput, text: string): CursorAskOutcome {
  const trimmed = text.trim()
  if (!trimmed || /^cancel/i.test(trimmed) || trimmed === '已取消') {
    return { outcome: 'cancelled' }
  }
  if (/^skip/i.test(trimmed)) {
    return { outcome: 'skipped', reason: trimmed }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { outcome: 'skipped', reason: trimmed }
  }
  const rec = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  const rows = Array.isArray(rec?.answers) ? rec!.answers : []
  if (rows.length === 0) return { outcome: 'skipped', reason: trimmed }

  const answers: Array<{ questionId: string; selectedOptionIds: string[] }> = []
  for (const item of rows) {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const index = typeof row.questionIndex === 'number' ? row.questionIndex : answers.length
    const question = ask.questions[index]
    if (!question) continue
    const value = row.value
    const labels = Array.isArray(value)
      ? value.map((part) => String(part).trim()).filter(Boolean)
      : String(value ?? '')
          .split('\n')
          .map((part) => part.trim())
          .filter(Boolean)
    const selectedOptionIds: string[] = []
    for (const label of labels) {
      const hit = question.options.find((option) => option.label === label || option.id === label)
      if (hit) selectedOptionIds.push(hit.id)
    }
    answers.push({ questionId: question.id, selectedOptionIds })
  }
  return { outcome: 'answered', answers }
}

export type PlanDocOutcome = { outcome: 'accepted'; planUri?: string } | { outcome: 'rejected'; reason?: string } | { outcome: 'cancelled' }

export function planDocOutcomeFromAnswer(text: string, reject: boolean): PlanDocOutcome {
  if (reject) {
    const reason = text.trim()
    if (/^cancel/i.test(reason) || reason === '已取消') return { outcome: 'cancelled' }
    return { outcome: 'rejected', reason: reason || undefined }
  }
  return { outcome: 'accepted' }
}
