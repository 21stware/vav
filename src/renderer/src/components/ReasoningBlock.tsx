import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { thinkingSeconds } from '@shared/thinkingLevel'
import { useT } from '../i18n/useT'

function thoughtLabel(
  t: ReturnType<typeof useT>,
  durationMs?: number
): string {
  if (durationMs == null) return t('composer.thinking')
  const n = thinkingSeconds(durationMs)
  return n === 1 ? t('composer.thinkingForOne') : t('composer.thinkingFor', { n })
}

/**
 * Live: body open, "Thinking…" shimmers.
 * After this step seals: fold to "Thought for n seconds".
 * `flat`: no row chrome — just the thinking prose (inside Thinking process).
 */
export function ReasoningBlock({
  text,
  live = false,
  durationMs,
  flat = false
}: {
  text: string
  live?: boolean
  durationMs?: number
  flat?: boolean
}): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(live)
  const canToggle = text.trim().length > 0

  useEffect(() => {
    setOpen(live)
  }, [live])

  if (flat) {
    return (
      <div className="reasoning-flat">
        <div className="reasoning-body">{text}</div>
      </div>
    )
  }

  const label = live ? t('composer.thinking') : thoughtLabel(t, durationMs)

  return (
    <div
      className={`tool-call reasoning-call${open ? ' expanded' : ''}${live ? ' is-live' : ''}`}
    >
      <button
        type="button"
        className="tool-row"
        disabled={!canToggle}
        aria-expanded={canToggle ? open : undefined}
        title={canToggle ? (open ? t('common.collapse') : t('common.expand')) : undefined}
        onClick={() => {
          if (canToggle) setOpen((value) => !value)
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
          <div className="tool-detail-inner">
            <div className="reasoning-body">{text}</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
