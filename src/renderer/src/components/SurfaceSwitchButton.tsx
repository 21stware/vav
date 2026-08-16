import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useSessionStore, visibleMessages } from '../state/sessionStore'
import {
  canSwitchCliSurface,
  isSoleEmptyCliPicker,
  requestCliSurface
} from '../lib/cliSurfaceSwitch'
import { isCliSurfaceLocked } from '../lib/cliSurfaceAuthority'
import { isCompanionSessionShell } from '../lib/windowKind'
import { keys } from '../lib/platform'
import { useT } from '../i18n/useT'

export { isSoleEmptyCliPicker }

export function useThreadEmpty(conversationId: string): boolean {
  return useSessionStore((s) => visibleMessages(s, conversationId).length === 0)
}

/**
 * → Swarm on the empty Thread; ← Thread only under a single empty Swarm panel.
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
  if (!conversationId || locked) return null
  if (!canSwitchCliSurface(conversationId, target === 'swarm')) return null

  const label = target === 'swarm' ? t('agents.terminalMode') : t('agents.chatMode')
  const hint =
    target === 'swarm'
      ? `${t('agents.terminalModeHint')} ${keys('⌘⇧C')}`
      : `${t('agents.chatModeHint')} ${keys('⌘⇧V')}`

  const onClick = (): void => {
    if (useSessionStore.getState().search.open) {
      useSessionStore.getState().closeSearch()
    }
    requestCliSurface(conversationId, target === 'swarm')
  }

  return (
    <button type="button" className="agent-mode-swarm-btn" title={hint} onClick={onClick}>
      {target === 'thread' ? (
        <ArrowLeft size={13} strokeWidth={2} />
      ) : (
        <ArrowRight size={13} strokeWidth={2} />
      )}
      <span>{label}</span>
    </button>
  )
}
