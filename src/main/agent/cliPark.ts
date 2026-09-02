import type { ToolCallBlock } from '../../shared/types.ts'
import { normalizeAskQuestions, parseToolInput } from '../../shared/askPlan.ts'
import {
  isPlanDocToolName,
  normalizePlanDocInput,
  planDocHasBody
} from '../../shared/planDoc.ts'

export type ParkInteractiveKind = 'ask' | 'plan_doc'

export function parkInteractivePatch(
  block: ToolCallBlock,
  event: { status: string; name: string; title?: string },
  alreadyPending: boolean
): { kind: ParkInteractiveKind; next: ToolCallBlock } | null {
  if (event.status === 'completed' || event.status === 'error') return null
  if (alreadyPending) return null
  const parsed = parseToolInput(block.input)
  if (block.tool === 'ask_user_question') {
    const questions = normalizeAskQuestions(parsed)
    if (questions.length === 0) return null
    return {
      kind: 'ask',
      next: {
        ...block,
        status: 'pending',
        questions,
        askTitle: event.title || String(parsed.title ?? parsed.header ?? '') || block.askTitle
      }
    }
  }
  if (block.tool === 'plan_doc') {
    const doc = normalizePlanDocInput(parsed)
    if (!isPlanDocToolName(event.name) && !planDocHasBody(doc)) return null
    return { kind: 'plan_doc', next: { ...block, status: 'pending' } }
  }
  return null
}
