import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useT } from '../i18n/useT'
import { EXPAND_PROCESS_EVENT } from '../lib/mdMarks'
import { thinkingLabel } from '../lib/thinkingCopy'
import { ThinkingViewport } from './ThinkingViewport'

/**
 * Shell for a thinking run. Collapsed by default — the user opens it.
 * The header is the duration phrase, not a second clock under a title.
 */
export function ThinkingProcess({
  steps,
  durationMs,
  follow = false,
  children
}: {
  steps: number
  durationMs?: number
  /** Stick the well to the newest step while the turn is still streaming. */
  follow?: boolean
  children: ReactNode
}): React.JSX.Element {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(follow)
  useEffect(() => {
    if (follow) setOpen(true)
  }, [follow])
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onExpand = (): void => setOpen(true)
    el.addEventListener(EXPAND_PROCESS_EVENT, onExpand)
    return () => el.removeEventListener(EXPAND_PROCESS_EVENT, onExpand)
  }, [])
  const summary =
    durationMs != null
      ? thinkingLabel(durationMs, follow, t)
      : follow
        ? t('composer.thinking')
        : t('composer.thinkingProcessSteps', { n: steps })

  return (
    <div
      ref={rootRef}
      className={`tool-call thinking-process${open ? ' expanded' : ''}`}
      data-testid="thinking-process"
    >
      <button
        type="button"
        className="tool-row"
        aria-expanded={open}
        title={open ? t('common.collapse') : t('common.expand')}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight className="tool-chevron" size={11} />
        <span className={`tool-name${follow ? ' stream-status-shimmer' : ''}`}>{summary}</span>
      </button>
      <div className="tool-detail" aria-hidden={!open}>
        <div className="tool-detail-inner">
          <ThinkingViewport follow={follow}>
            <div className="thinking-process-body">{children}</div>
          </ThinkingViewport>
        </div>
      </div>
    </div>
  )
}
