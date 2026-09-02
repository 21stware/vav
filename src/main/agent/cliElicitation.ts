import type { AskQuestion, ToolCallBlock } from '../../shared/types.ts'
import { normalizeAskQuestions } from '../../shared/askPlan.ts'
import { normalizePlanDocInput, planDocSummary } from '../../shared/planDoc.ts'
import { acpFormToQuestions, parseAcpFormSchema } from '../../shared/acpSession.ts'

export function elicitationCardFields(
  event: { kind: string; input: unknown; title?: string },
  labels: { ask: string; open: string; cancel: string }
): {
  tool: ToolCallBlock['tool']
  questions?: AskQuestion[]
  summary: string
  choices?: string[]
} {
  const tool: ToolCallBlock['tool'] =
    event.kind === 'plan_doc' ? 'plan_doc' : event.kind === 'url' ? 'request' : 'ask_user_question'
  const parsed =
    event.input && typeof event.input === 'object' ? (event.input as Record<string, unknown>) : {}
  const formFields =
    event.kind === 'form' ? parseAcpFormSchema(parsed.requestedSchema ?? parsed.schema) : []
  const questions =
    event.kind === 'ask'
      ? normalizeAskQuestions(parsed)
      : event.kind === 'form'
        ? acpFormToQuestions(formFields.length ? formFields : parseAcpFormSchema(parsed))
        : undefined
  const summary =
    event.kind === 'plan_doc'
      ? planDocSummary(normalizePlanDocInput(event.input))
      : event.kind === 'url'
        ? event.title || (typeof parsed.url === 'string' ? parsed.url : labels.ask)
        : event.title || questions?.[0]?.question || labels.ask
  return {
    tool,
    questions,
    summary,
    choices: event.kind === 'url' ? [labels.open, labels.cancel] : undefined
  }
}

/** Reuse a parked elicitation card when the host remaps the toolCallId. */
export function findPendingElicitationIndex(
  pendingPermissions: Iterable<[string, { kind: string }]>,
  toolIndex: { get(id: string): number | undefined },
  kind: string
): { index: number; previousId: string } | null {
  for (const [id, pending] of pendingPermissions) {
    if (pending.kind !== kind) continue
    const found = toolIndex.get(id)
    if (found == null) continue
    return { index: found, previousId: id }
  }
  return null
}
