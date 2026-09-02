import type { MessageBlock } from '../../shared/types.ts'
import { parseToolInput } from '../../shared/askPlan.ts'
import { projectChecklistInput, sealPlanSteps } from '../../shared/planDoc.ts'

/**
 * Reconcile plan checklist state when a turn ends.
 *
 * Models often complete the work then write a final answer without a last
 * `plan` tool call, leaving steps pending and the UI stuck on "paused".
 * - cancel: executing→error, pending→skipped
 * - error:  executing→error (pending left so the user sees what was not started)
 * - success: any still-open step is treated as finished work the agent forgot
 *   to tick off → done (abandoned work should have been marked skipped mid-turn)
 */

type SealLabels = { cancelled: string; failed: string }

export type PlanSealMode = 'cancel' | 'error' | 'success'

export function planSealMode(
  cancelled: boolean | null | undefined,
  error?: string | null
): PlanSealMode {
  if (cancelled) return 'cancel'
  if (error) return 'error'
  return 'success'
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function writeJson(input: unknown): string {
  try {
    return JSON.stringify(input ?? {})
  } catch {
    return '{}'
  }
}

function markPlanComplete(
  block: Extract<MessageBlock, { kind: 'toolCall' }>,
  title: string,
  steps: { status: string }[],
  input: string
): void {
  const done = steps.filter((step) => step.status === 'done').length
  block.input = input
  block.summary = `Plan · ${title} (${done}/${steps.length})`
  if (block.status === 'pending' || block.status === 'executing') {
    block.status = 'completed'
  }
}

/** Builtin agent: pretty-print the whole checklist object, default title "Plan". */
export function sealRuntimePlanBlocks(
  blocks: MessageBlock[],
  mode: PlanSealMode,
  labels: SealLabels
): void {
  for (const block of blocks) {
    if (block.kind !== 'toolCall' || block.tool !== 'plan') continue
    const input = projectChecklistInput(parseJsonObject(block.input))
    const steps = sealPlanSteps(input.steps, mode, labels)
    const title = input.title || 'Plan'
    markPlanComplete(block, title, steps, JSON.stringify({ ...input, title, steps }, null, 2))
  }
}

/** CLI host: skip empty checklists and write compact `{ title, steps }`. */
export function sealCliPlanBlocks(
  blocks: MessageBlock[],
  mode: PlanSealMode,
  labels: SealLabels
): void {
  for (const block of blocks) {
    if (block.kind !== 'toolCall' || block.tool !== 'plan') continue
    const input = projectChecklistInput(parseToolInput(block.input))
    if (input.steps.length === 0) continue
    const steps = sealPlanSteps(input.steps, mode, labels)
    markPlanComplete(block, input.title, steps, writeJson({ title: input.title, steps }))
  }
}
