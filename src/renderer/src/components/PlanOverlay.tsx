import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Loader2,
  MinusCircle,
  XCircle
} from 'lucide-react'
import { normalizePlanSteps, parseToolInput } from '@shared/askPlan'
import type { PlanStep, PlanStepStatus, ToolCallBlock, TurnPhase } from '@shared/types'
import { getProjection } from '../state/StreamProjection'
import { useSessionStore, visibleMessages } from '../state/sessionStore'
import { latestPlanToolId, PlanCard } from './PlanCard'
import { useT, tt } from '../i18n/useT'

/** Matches the 200ms slide-up + fade dismiss in main-chat-streaming.rpml. */
const DISMISS_MS = 200
/** Cancelled state stays visible briefly before dismiss. */
const CANCEL_HOLD_MS = 2000

interface PlanView {
  block: ToolCallBlock
  title: string
  steps: PlanStep[]
  done: number
  executing: PlanStep | undefined
  errored: PlanStep | undefined
  allDone: boolean
  cancelled: boolean
}

function viewFromBlock(block: ToolCallBlock, turnRunning: boolean): PlanView | null {
  const input = parseToolInput(block.input)
  const title = String(input.title ?? 'Plan').trim() || 'Plan'
  const steps = normalizePlanSteps(input.steps)
  if (steps.length === 0) return null
  const done = steps.filter((s) => s.status === 'done').length
  const executing = steps.find((s) => s.status === 'executing')
  const errored = steps.find((s) => s.status === 'error')
  const allDone = done === steps.length
  const cancelled =
    !turnRunning &&
    (!!errored?.subtitle?.includes('已取消') ||
      !!errored?.subtitle?.includes(tt('common.cancelled')))
  return { block, title, steps, done, executing, errored, allDone, cancelled }
}

/** Loader spin only while the turn is actively streaming (working/outputting). */
function isPlanStreaming(phase: TurnPhase | undefined, isRunning: boolean): boolean {
  return isRunning && (phase === 'working' || phase === 'outputting')
}

/**
 * Collapsible plan mask over the transcript — active only while running.
 * Completes / cancels auto-dismiss; PlanTodo data stays in the agent log.
 */
export function PlanOverlay(): React.JSX.Element | null {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const messages = useSessionStore((s) => visibleMessages(s, s.activeId))
  const turn = useSessionStore((s) => s.turns[s.activeId])
  const turnRunning = !!turn?.isRunning
  const streaming = isPlanStreaming(turn?.phase, turnRunning)
  const [streamTick, setStreamTick] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [planId, setPlanId] = useState<string | null>(null)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set())
  const [leaving, setLeaving] = useState(false)
  const [held, setHeld] = useState<PlanView | null>(null)

  useEffect(() => {
    const projection = getProjection(activeId)
    return projection.subscribe(() => setStreamTick((n) => n + 1))
  }, [activeId])

  useEffect(() => {
    setExpanded(false)
    setPlanId(null)
    setDismissedIds(new Set())
    setLeaving(false)
    setHeld(null)
  }, [activeId])

  const live = useMemo(() => {
    void streamTick
    const projection = getProjection(activeId).getSnapshot()
    const liveBlocks = projection.blocks
      .filter((b): b is { kind: 'tool'; key: string; block: ToolCallBlock } => b.kind === 'tool')
      .map((b) => b.block)
    const sealed = messages.flatMap((m) =>
      m.blocks.filter((b): b is ToolCallBlock => b.kind === 'toolCall')
    )
    const all = [...sealed, ...liveBlocks]
    const id = latestPlanToolId(all.map((b) => ({ kind: 'toolCall', id: b.id, tool: b.tool })))
    if (!id || dismissedIds.has(id)) return null
    const block = all.find((b) => b.id === id && b.tool === 'plan')
    return block ? viewFromBlock(block, turnRunning) : null
  }, [activeId, messages, streamTick, dismissedIds, turnRunning])

  useEffect(() => {
    if (!live) return
    if (live.block.id !== planId) {
      setPlanId(live.block.id)
      setExpanded(false)
    }
  }, [live, planId])

  useEffect(() => {
    if (live) {
      setHeld(live)
      if (!live.allDone && !live.cancelled) setLeaving(false)
    }
  }, [live])

  useEffect(() => {
    if (!live) return

    if (live.allDone) {
      setLeaving(true)
      const timer = window.setTimeout(() => {
        setDismissedIds((prev) => new Set(prev).add(live.block.id))
        setHeld(null)
        setLeaving(false)
      }, DISMISS_MS)
      return () => window.clearTimeout(timer)
    }

    if (live.cancelled) {
      const hold = window.setTimeout(() => setLeaving(true), CANCEL_HOLD_MS)
      const gone = window.setTimeout(() => {
        setDismissedIds((prev) => new Set(prev).add(live.block.id))
        setHeld(null)
        setLeaving(false)
      }, CANCEL_HOLD_MS + DISMISS_MS)
      return () => {
        window.clearTimeout(hold)
        window.clearTimeout(gone)
      }
    }
  }, [live])

  const view = live ?? (leaving ? held : null)
  if (!view) return null

  const { block, title, steps, done, executing, errored, allDone, cancelled } = view

  let kind: 'info' | 'warning' | 'success' = 'info'
  let status: PlanStepStatus = executing?.status ?? 'pending'
  let line = `Plan · ${title} — step ${Math.min(done + 1, steps.length)}/${steps.length}`
  if (executing) {
    line += `: ${executing.title}`
    status = 'executing'
  } else if (allDone) {
    kind = 'success'
    status = 'done'
    line = `Plan · ${title} — all ${steps.length} steps complete`
  } else if (errored) {
    kind = 'warning'
    status = 'error'
    line = cancelled
      ? `Plan · ${title} — cancelled at step ${done + 1}/${steps.length}`
      : `Plan · ${title} — step ${done + 1}/${steps.length} failed: ${errored.subtitle ?? errored.title}`
  } else if (!streaming && done > 0) {
    status = 'done'
    line = `Plan · ${title} — ${done}/${steps.length} done, paused`
  } else if (!expanded && done > 0) {
    line = `Plan · ${title} — ${done}/${steps.length} done`
  }

  // When the turn is not actively streaming, freeze banner to a static progress icon.
  const bannerStatus: PlanStepStatus = streaming
    ? status
    : allDone
      ? 'done'
      : errored
        ? 'error'
        : done > 0
          ? 'done'
          : status === 'executing'
            ? 'executing'
            : 'pending'

  return (
    <div
      className="plan-overlay"
      data-kind={kind}
      data-expanded={expanded && !leaving}
      data-leaving={leaving}
    >
      <div className="plan-overlay-bar">
        <span className="plan-overlay-icon">
          <BannerIcon status={bannerStatus} animate={streaming} />
        </span>
        <span className="plan-overlay-text" key={line} title={line}>
          {truncate(line, 80)}
        </span>
        <span className="plan-overlay-count">
          {done}/{steps.length}
        </span>
        {!leaving && (
          <button
            type="button"
            className="plan-overlay-toggle"
            title={expanded ? t('common.collapse') : t('common.expand')}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>
      {expanded && !leaving && <PlanCard block={block} animate={streaming} />}
    </div>
  )
}

function BannerIcon({
  status,
  animate
}: {
  status: PlanStepStatus
  animate: boolean
}): React.JSX.Element {
  switch (status) {
    case 'executing':
      return <Loader2 className={animate ? 'spin' : undefined} size={14} />
    case 'done':
      return <CheckCircle2 size={14} />
    case 'error':
      return <XCircle size={14} />
    case 'skipped':
      return <MinusCircle size={14} />
    default:
      return <Circle size={14} />
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
