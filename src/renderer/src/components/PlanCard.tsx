import {
  CheckCircle2,
  Circle,
  Loader2,
  MinusCircle,
  XCircle
} from 'lucide-react'
import { normalizePlanSteps, parseToolInput } from '@shared/askPlan'
import type { PlanStep, PlanStepStatus, ToolCallBlock } from '@shared/types'
import { useT } from '../i18n/useT'

/**
 * Visible checklist driven by the `plan` tool.
 *
 * Not an expandable tool card — the product treats this as a UI projection of
 * the agent's to-do list (main-chat-streaming.rpml, Plan 模式).
 */
export function PlanCard({
  block,
  animate = true
}: {
  block: ToolCallBlock
  /** When false, executing loaders freeze as static icons (turn paused). */
  animate?: boolean
}): React.JSX.Element {
  const t = useT()
  const input = parseToolInput(block.input)
  const title = String(input.title ?? t('plan.title')).trim() || t('plan.title')
  const steps = normalizePlanSteps(input.steps)
  const done = steps.filter((step) => step.status === 'done').length

  return (
    <div className="plan-card" data-status={block.status}>
      <div className="plan-header">
        {t('plan.title')} · {title}{' '}
        <span className="plan-count">
          ({done}/{steps.length})
        </span>
      </div>
      <ul className="plan-steps">
        {steps.map((step) => (
          <PlanStepRow key={step.id} step={step} animate={animate} />
        ))}
      </ul>
    </div>
  )
}

function PlanStepRow({ step, animate }: { step: PlanStep; animate: boolean }): React.JSX.Element {
  return (
    <li className="plan-step" data-status={step.status}>
      {/* Remount on status change so the icon enter animation fires each hop. */}
      <span className="plan-step-icon" key={`${step.status}-${animate}`}>
        <StepIcon status={step.status} animate={animate} />
      </span>
      <span className="plan-step-title">{step.title}</span>
    </li>
  )
}

function StepIcon({
  status,
  animate
}: {
  status: PlanStepStatus
  animate: boolean
}): React.JSX.Element {
  switch (status) {
    case 'executing':
      return <Loader2 className={animate ? 'spin' : undefined} size={16} />
    case 'done':
      return <CheckCircle2 size={16} />
    case 'error':
      return <XCircle size={16} />
    case 'skipped':
      return <MinusCircle size={16} />
    default:
      return <Circle size={16} />
  }
}

/** Latest plan tool in a block list wins; older plan cards are hidden. */
export function latestPlanToolId(
  blocks: Array<{ kind: string; id?: string; tool?: string }>
): string | null {
  let latest: string | null = null
  for (const block of blocks) {
    if (block.kind === 'toolCall' && block.tool === 'plan' && block.id) latest = block.id
  }
  return latest
}
