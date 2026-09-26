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
  citeKeys,
  children
}: {
  steps: number
  durationMs?: number
  /** Stick the well to the newest step while the turn is still streaming. */
  follow?: boolean
  /** Hoisted from nested tool output so a collapsed well can still be found. */
  citeKeys?: string
  children: ReactNode
}): React.JSX.Element {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(follow)
  const [bodyReady, setBodyReady] = useState(follow)
  useEffect(() => {
    if (!follow) return
    setOpen(true)
    setBodyReady(true)
  }, [follow])
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onExpand = (): void => {
      setBodyReady(true)
      setOpen(true)
    }
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
      data-cite-keys={citeKeys || undefined}
    >
      <button
        type="button"
        className="tool-row"
        aria-expanded={open}
        title={open ? t('common.collapse') : t('common.expand')}
        onClick={() => {
          setOpen((value) => {
            const next = !value
            if (next) setBodyReady(true)
            return next
          })
        }}
      >
        <ChevronRight className="tool-chevron" size={11} />
        <span className={`tool-name${follow ? ' stream-status-shimmer' : ''}`}>{summary}</span>
      </button>
      <div className="tool-detail" aria-hidden={!open}>
        {bodyReady ? (
          <div className="tool-detail-inner">
            <ThinkingViewport follow={follow}>
              <div className="thinking-process-body">{children}</div>
            </ThinkingViewport>
          </div>
        ) : null}
      </div>
    </div>
  )
}
