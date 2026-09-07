import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { thinkingSeconds } from '@shared/thinkingLevel'
import { useT } from '../i18n/useT'
import { EXPAND_PROCESS_EVENT } from '../lib/mdMarks'

/**
 * Collapsed-by-default shell for the non-final stretch of a finished turn.
 * Children are themselves collapsed rows (reasoning / tools / notes).
 */
export function ThinkingProcess({
  steps,
  durationMs,
  collapseOnMount = false,
  children
}: {
  steps: number
  durationMs?: number
  /** Stream just hit the answer: paint open, then fold. */
  collapseOnMount?: boolean
  children: ReactNode
}): React.JSX.Element {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(collapseOnMount)
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onExpand = (): void => setOpen(true)
    el.addEventListener(EXPAND_PROCESS_EVENT, onExpand)
    return () => el.removeEventListener(EXPAND_PROCESS_EVENT, onExpand)
  }, [])
  useEffect(() => {
    if (!collapseOnMount) return
    let inner = 0
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => setOpen(false))
    })
    return () => {
      window.cancelAnimationFrame(outer)
      window.cancelAnimationFrame(inner)
    }
  }, [collapseOnMount])
  const summary =
    durationMs != null
      ? t('composer.thinkingFor', { n: thinkingSeconds(durationMs) })
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
        <span className="tool-name">{t('composer.thinkingProcess')}</span>
        <span className="tool-summary">{summary}</span>
      </button>
      <div className="tool-detail" aria-hidden={!open}>
        <div className="tool-detail-inner">
          <div className="thinking-process-body">{children}</div>
        </div>
      </div>
    </div>
  )
}
