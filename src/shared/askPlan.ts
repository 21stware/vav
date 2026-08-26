/**
 * Shared parsers for ask_user_question / plan tool inputs.
 *
 * Kept outside the main-process tool host so the renderer can rebuild cards
 * from persisted `input` JSON when interactive fields were not mirrored.
 */
import type { AskQuestion, PlanStep, PlanStepStatus } from './types'

/** Cap presets so the card stays scannable; UI always offers Other. */
const ASK_CHOICES_CAP = 4
const ASK_QUESTIONS_CAP = 5

function normalizeChoices(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const cleaned = raw
    .map((choice) => String(choice).trim())
    .filter((choice) => choice.length > 0)
  if (cleaned.length === 0) return undefined
  return cleaned.slice(0, ASK_CHOICES_CAP)
}

function choicesFromQuestion(row: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(row.options) && row.options.length > 0) {
    const labels = row.options
      .map((item) => {
        if (typeof item === 'string') return item.trim()
        if (item && typeof item === 'object') {
          const rec = item as Record<string, unknown>
          return String(rec.label ?? rec.value ?? '').trim()
        }
        return ''
      })
      .filter((label) => label.length > 0)
    return labels.length ? labels : undefined
  }
  return normalizeChoices(row.choices)
}

export function normalizeAskQuestions(params: Record<string, unknown>): AskQuestion[] {
  if (Array.isArray(params.questions) && params.questions.length > 0) {
    return params.questions
      .map((item) => {
        const row = item as Record<string, unknown>
        return {
          question: String(row.question ?? row.prompt ?? row.header ?? '').trim(),
          choices: choicesFromQuestion(row),
          multiSelect:
            row.multiSelect === true || row.allowMultiple === true || row.multiple === true
        }
      })
      .filter((item) => item.question.length > 0)
      .slice(0, ASK_QUESTIONS_CAP)
  }
  const question = String(params.question ?? params.prompt ?? params.header ?? '').trim()
  if (!question) return []
  return [
    {
      question,
      choices: choicesFromQuestion(params) ?? normalizeChoices(params.choices),
      multiSelect: params.multiSelect === true || params.allowMultiple === true
    }
  ]
}

const PLAN_STATUS_ALIAS: Record<string, PlanStepStatus> = {
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

export function normalizePlanSteps(raw: unknown): PlanStep[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item, index) => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const alias = String(row.status ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
    let status = PLAN_STATUS_ALIAS[alias]
    if (!status) {
      if (row.completed === true || row.done === true) status = 'done'
      else if (row.active === true) status = 'executing'
      else status = 'pending'
    }
    return {
      id: String(row.id ?? `step-${index}`),
      title: String(row.title ?? row.content ?? `Step ${index + 1}`),
      status,
      subtitle: row.subtitle != null ? String(row.subtitle) : undefined
    }
  })
}

export function parseToolInput(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
