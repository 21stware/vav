import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'

/**
 * Bottom-right LED for this window's conversation:
 * blinking green = running, solid green = done (unseen), hidden = idle.
 * Status comes from the same snapshot as the tray.
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
      aria-label={status === 'running' ? t('activity.running') : t('activity.done')}
      title={status === 'running' ? t('activity.running') : t('activity.done')}
    />
  )
}
