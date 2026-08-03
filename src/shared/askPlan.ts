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

export function normalizeAskQuestions(params: Record<string, unknown>): AskQuestion[] {
  if (Array.isArray(params.questions) && params.questions.length > 0) {
    return params.questions
      .map((item) => {
        const row = item as Record<string, unknown>
        return {
          question: String(row.question ?? '').trim(),
          choices: normalizeChoices(row.choices),
          multiSelect: row.multiSelect === true
        }
      })
      .filter((item) => item.question.length > 0)
      .slice(0, ASK_QUESTIONS_CAP)
  }
  const question = String(params.question ?? '').trim()
  if (!question) return []
  return [
    {
      question,
      choices: normalizeChoices(params.choices),
      multiSelect: params.multiSelect === true
    }
  ]
}

export function normalizePlanSteps(raw: unknown): PlanStep[] {
  if (!Array.isArray(raw)) return []
  const allowed: PlanStepStatus[] = ['pending', 'executing', 'done', 'error', 'skipped']
  return raw.map((item, index) => {
    const row = item as Record<string, unknown>
    const status = allowed.includes(row.status as PlanStepStatus)
      ? (row.status as PlanStepStatus)
      : 'pending'
    return {
      id: String(row.id ?? `step-${index}`),
      title: String(row.title ?? `Step ${index + 1}`),
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
