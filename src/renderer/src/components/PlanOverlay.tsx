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
import { catalogTextIncludes } from '@shared/i18n'
import { parseToolInput } from '@shared/askPlan'
import { projectChecklistInput } from '@shared/planDoc'
import type { PlanStep, PlanStepStatus, ToolCallBlock, TurnPhase } from '@shared/types'
import { getProjection } from '../state/StreamProjection'
import { useSessionStore, visibleMessages } from '../state/sessionStore'
import { PlanCard } from './PlanCard'
import { useT } from '../i18n/useT'

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

function latestPlanBlock(blocks: ToolCallBlock[]): ToolCallBlock | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (block?.tool !== 'plan') continue
    if (projectChecklistInput(parseToolInput(block.input)).steps.length === 0) continue
    return block
  }
  return null
}

function viewFromBlock(block: ToolCallBlock, turnRunning: boolean): PlanView | null {
  const { title, steps } = projectChecklistInput(parseToolInput(block.input))
  if (steps.length === 0) return null
  const done = steps.filter((s) => s.status === 'done').length
  const executing = steps.find((s) => s.status === 'executing')
  const errored = steps.find((s) => s.status === 'error')
  const allDone = done === steps.length
  const cancelled =
    !turnRunning &&
    (!!errored?.subtitle && catalogTextIncludes('common.cancelled', errored.subtitle))
  return { block, title, steps, done, executing, errored, allDone, cancelled }
}

/** Loader spin only while the turn is actively streaming (working/outputting). */
function isPlanStreaming(phase: TurnPhase | undefined, isRunning: boolean): boolean {
  return isRunning && (phase === 'working' || phase === 'outputting' || phase === 'retrying' || phase === 'reconnecting' || phase === 'healing')
}

/**
 * Collapsible plan mask over the transcript — active only while running.
 * Completes / cancels auto-dismiss; PlanTodo data stays in the agent log.
 */
export function PlanOverlay({
  conversationId
}: {
  conversationId?: string
} = {}): React.JSX.Element | null {
  const t = useT()
  const storeActiveId = useSessionStore((s) => s.activeId)
  const activeId = conversationId || storeActiveId
  const nodes = useSessionStore((s) => s.messages[activeId])
  const activeLeaf = useSessionStore((s) => s.activeLeaf[activeId] ?? null)
  const messages = useMemo(
    () => visibleMessages(useSessionStore.getState(), activeId),
    [activeId, nodes, activeLeaf]
  )
  const turn = useSessionStore((s) => s.turns[activeId])
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
    // Live wins: CLI hosts reuse a stable plan id across turns, so a sealed
    // copy of the same id would otherwise freeze the overlay at 0 done.
    const block =
      latestPlanBlock(liveBlocks) ?? latestPlanBlock(sealed)
    if (!block || dismissedIds.has(block.id)) return null
    return viewFromBlock(block, turnRunning)
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
      data-testid="plan-overlay"
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
            data-testid="plan-overlay-toggle"
            title={expanded ? t('common.collapse') : t('common.expand')}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>
      <div className="plan-overlay-body">
        <div className="plan-overlay-body-inner">
          <PlanCard block={block} animate={streaming} />
        </div>
      </div>
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
