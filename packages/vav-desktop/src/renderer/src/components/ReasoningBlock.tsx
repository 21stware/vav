import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useT } from '../i18n/useT'
import { thinkingLabel } from '../lib/thinkingCopy'
import { MarkdownView } from './MarkdownView'
import { ThinkingViewport } from './ThinkingViewport'

/**
 * Collapsed by default. Live still ticks the header as "Thinking for…";
 * the user opens the body. `flat`: no row chrome — just the thinking prose
 * (inside Thinking process).
 */
export function ReasoningBlock({
  text,
  live = false,
  durationMs,
  flat = false,
  follow = false
}: {
  text: string
  live?: boolean
  durationMs?: number
  flat?: boolean
  /** Stick the well to the newest line. Live streams pass this. */
  follow?: boolean
}): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [bodyReady, setBodyReady] = useState(false)
  const canToggle = text.trim().length > 0
  const stick = follow || live

  if (flat) {
    if (!text.trim()) return <div className="reasoning-flat" data-testid="reasoning" />
    return (
      <div className="reasoning-flat" data-testid="reasoning">
        <div className="reasoning-body">
          <MarkdownView source={text} cached={!live} />
        </div>
      </div>
    )
  }

  const label = thinkingLabel(durationMs, live, t)

  return (
    <div
      className={`tool-call reasoning-call${open ? ' expanded' : ''}${live ? ' is-live' : ''}`}
      data-testid="reasoning"
    >
      <button
        type="button"
        className="tool-row"
        disabled={!canToggle}
        aria-expanded={canToggle ? open : undefined}
        title={canToggle ? (open ? t('common.collapse') : t('common.expand')) : undefined}
        onClick={() => {
          if (!canToggle) return
          setOpen((value) => {
            const next = !value
            if (next) setBodyReady(true)
            return next
          })
        }}
      >
        {canToggle ? (
          <ChevronRight className="tool-chevron" size={11} />
        ) : (
          <span className="tool-chevron-spacer" />
        )}
        <span className={`tool-name${live ? ' stream-status-shimmer' : ''}`}>{label}</span>
      </button>
      {canToggle ? (
        <div className="tool-detail" aria-hidden={!open}>
          {bodyReady ? (
            <div className="tool-detail-inner">
              <ThinkingViewport follow={stick}>
                <div className="reasoning-body">
                  <MarkdownView source={text} cached={!live} />
                </div>
              </ThinkingViewport>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
