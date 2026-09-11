import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'

/**
 * Window-corner LED for detached session windows (no sidebar list).
 * The main shell keeps the same LED on the session row (`.conv-badge`).
 * blinking yellow = running, solid green = done (unseen),
 * solid red = cancel / abnormal exit (unseen), hidden = idle.
 */
export function ActivityDot({ conversationId }: { conversationId: string | null }): React.JSX.Element | null {
  const t = useT()
  const status = useSessionStore((s) =>
    conversationId ? (s.activityById[conversationId] ?? 'idle') : 'idle'
  )
  if (status === 'idle') return null

  return (
    <div
      className={`activity-dot is-${status}`}
      role="status"
      aria-label={
        status === 'running'
          ? t('activity.running')
          : status === 'failed'
            ? t('activity.failed')
            : t('activity.done')
      }
      title={
        status === 'running'
          ? t('activity.running')
          : status === 'failed'
            ? t('activity.failed')
            : t('activity.done')
      }
    />
  )
}
