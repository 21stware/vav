import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useSessionStore } from '../state/sessionStore'
import { requestCliSurface } from '../lib/cliSurfaceSwitch'
import { isCliSurfaceLocked } from '../lib/cliSurfaceAuthority'
import { isCompanionSessionShell } from '../lib/windowKind'
import { keys } from '../lib/platform'
import { useT } from '../i18n/useT'

/**
 * One destination at a time: → Swarm on Thread, ← Thread on Swarm.
 * Either side stays clickable in any session state.
 */
export function SurfaceSwitchButton({
  conversationId,
  target
}: {
  conversationId: string
  target: 'thread' | 'swarm'
}): React.JSX.Element | null {
  const t = useT()
  const swarmEnabled = useSessionStore((s) => s.settings.swarmModeEnabled === true)
  const locked = useSessionStore((s) =>
    isCliSurfaceLocked(conversationId, s.detachedConversationIds, isCompanionSessionShell())
  )

  if (target === 'swarm' && !swarmEnabled) return null
  if (!conversationId) return null

  const label = target === 'swarm' ? t('agents.terminalMode') : t('agents.chatMode')
  const hint =
    target === 'swarm'
      ? `${t('agents.terminalModeHint')} ${keys('⌘⇧C')}`
      : `${t('agents.chatModeHint')} ${keys('⌘⇧V')}`

  const onClick = (): void => {
    if (locked) return
    if (useSessionStore.getState().search.open) {
      useSessionStore.getState().closeSearch()
    }
    requestCliSurface(conversationId, target === 'swarm')
  }

  return (
    <button
      type="button"
      className="agent-mode-swarm-btn"
      title={hint}
      disabled={locked}
      onClick={onClick}
    >
      {target === 'thread' ? (
        <ArrowLeft size={13} strokeWidth={2} />
      ) : (
        <ArrowRight size={13} strokeWidth={2} />
      )}
      <span>{label}</span>
    </button>
  )
}
