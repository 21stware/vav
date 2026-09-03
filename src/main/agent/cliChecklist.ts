import { parseToolInput } from '../../shared/askPlan.ts'
import {
  isChecklistToolName,
  isEnterPlanModeName,
  projectChecklistInput
} from '../../shared/planDoc.ts'

/** Fold host TodoWrite / update_plan / ACP plan onto one live `plan` card. */
export function shouldFoldChecklistTool(name: string, mapped: string): boolean {
  if (isEnterPlanModeName(name)) return false
  if (!isChecklistToolName(name) && mapped !== 'plan') return false
  return mapped === 'plan'
}

/** Skip a completed empty checklist that never opened a card. */
export function skipEmptyChecklistUpdate(stepCount: number, status: string): boolean {
  return stepCount === 0 && status !== 'started' && status !== 'updated'
}

/** Merge incoming checklist steps onto the previous plan card. */
export function checklistPlanFields(
  previousInput: string,
  incoming: { title: string; steps: Array<{ status: string }> }
): { input: { title: string; steps: unknown[] } | null; summary: string | null } {
  if (!incoming.steps.length) return { input: null, summary: null }
  const current = projectChecklistInput(parseToolInput(previousInput))
  const title =
    incoming.title && incoming.title !== 'Plan' ? incoming.title : current.title || incoming.title
  const done = incoming.steps.filter((step) => step.status === 'done').length
  return {
    input: { title, steps: incoming.steps },
    summary: `Plan · ${title} (${done}/${incoming.steps.length})`
  }
}
