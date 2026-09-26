import { useEffect, useRef, useState } from 'react'
import { ChevronRight, CircleAlert, Loader2 } from 'lucide-react'
import type { ToolCallBlock } from '@shared/types'
import { EXPAND_PROCESS_EVENT } from '../lib/mdMarks'
import { useT } from '../i18n/useT'
import { ToolCard } from './ToolCard'

function isLiveStatus(status: ToolCallBlock['status']): boolean {
  return status === 'executing' || status === 'pending'
}

function headlineFor(blocks: ToolCallBlock[]): { text: string; live: boolean; failed: boolean } {
  const live = blocks.some((block) => isLiveStatus(block.status))
  const failed = blocks.some((block) => block.status === 'error')
  if (!live) return { text: '', live: false, failed }
  const current =
    [...blocks].reverse().find((block) => isLiveStatus(block.status)) ?? blocks[blocks.length - 1]
  return { text: current?.summary.trim() || current?.tool || '', live: true, failed }
}

/** Split so path segments and CJK characters can stagger independently. */
function splitLabelUnits(text: string): string[] {
  const parts = text.split(/(\s+|\/)/).filter((part) => part.length > 0)
  if (parts.length === 1 && /[\u4e00-\u9fff]/.test(text)) return Array.from(text)
  return parts
}

function StaggerLabel({ text }: { text: string }): React.JSX.Element {
  const previous = useRef<string | null>(null)
  const stagger = previous.current != null && previous.current !== text
  previous.current = text
  const units = splitLabelUnits(text)
  return (
    <span
      key={stagger ? text : 'static'}
      className="tool-name tool-group-label"
      data-stagger={stagger || undefined}
      aria-label={text}
    >
      {units.map((unit, index) =>
        /^\s+$/.test(unit) ? (
          <span key={index}>{unit}</span>
        ) : (
          <span
            key={index}
            className="tool-stagger-unit"
            style={{ animationDelay: `${Math.min(index, 12) * 36}ms` }}
          >
            {unit}
          </span>
        )
      )}
    </span>
  )
}

/**
 * Consecutive line-style tool calls pack into one row.
 * Live: the latest summary staggers in as it changes.
 * Sealed: "Call n tools". Expand lists every member.
 */
export function ToolCallGroup({ blocks }: { blocks: ToolCallBlock[] }): React.JSX.Element {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const { text: liveText, live, failed } = headlineFor(blocks)
  const label = live ? liveText : t('tool.callN', { n: blocks.length })

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onExpand = (): void => setOpen(true)
    el.addEventListener(EXPAND_PROCESS_EVENT, onExpand)
    return () => el.removeEventListener(EXPAND_PROCESS_EVENT, onExpand)
  }, [])

  return (
    <div
      ref={rootRef}
      className={`tool-call tool-call-group${open ? ' expanded' : ''}${live ? ' is-live' : ''}`}
      data-testid="tool-call-group"
      data-count={blocks.length}
      data-status={live ? 'executing' : failed ? 'error' : 'completed'}
    >
      <button
        type="button"
        className="tool-row"
        aria-expanded={open}
        title={open ? t('common.collapse') : t('common.expand')}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight className="tool-chevron" size={11} />
        <StaggerLabel text={label} />
        {live && <Loader2 className="spin tool-mark" size={11} />}
        {failed && !live && <CircleAlert className="tool-mark failed" size={12} />}
      </button>
      <div className="tool-detail" aria-hidden={!open}>
        <div className="tool-detail-inner">
          <div className="tool-call-group-body">
            {blocks.map((block) => (
              <ToolCard key={block.id} block={block} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
