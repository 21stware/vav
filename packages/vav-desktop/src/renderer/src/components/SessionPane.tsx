import type { JSX } from 'react'
import { X } from 'lucide-react'
import { useSessionStore } from '../state/sessionStore'
import { setUiFocusScope } from '../lib/uiFocus'
import { useConversationFileDrop } from '../lib/useConversationFileDrop'
import { Transcript } from './Transcript'
import { Composer, ComposerContext } from './Composer'
import { PlanOverlay } from './PlanOverlay'
import { GoalBanner } from './GoalBanner'
import { Button } from './ui'
import { useT } from '../i18n/useT'

/**
 * One Swarm / Thread pane: structured chat.
 */
export function SessionPane({
  conversationId,
  compact,
  focused,
  onFocus,
  onClose
}: {
  conversationId: string
  compact: boolean
  focused: boolean
  onFocus: () => void
  onClose?: () => void
}): JSX.Element {
  const t = useT()
  const archived = useSessionStore(
    (s) => !!s.conversations.find((c) => c.id === conversationId)?.archived
  )
  const { dropActive, dropHandlers } = useConversationFileDrop(
    conversationId,
    !archived
  )

  return (
    <div
      className={`session-swarm-pane${focused ? ' is-active' : ''}${compact ? ' is-compact' : ''}`}
      data-testid="swarm-pane"
      data-swarm-pane={conversationId}
      data-cli-pane={conversationId}
      onMouseDown={() => {
        onFocus()
        setUiFocusScope('app')
      }}
      {...dropHandlers}
    >
      {compact && onClose ? (
        <button
          type="button"
          className="terminal-split-pane-close"
          title={t('common.close')}
          aria-label={t('common.close')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          <X size={12} strokeWidth={2} />
        </button>
      ) : null}

      {dropActive && (
        <div className="session-drop-overlay" aria-hidden="true">
          <div className="session-drop-hint">{t('composer.dropFiles')}</div>
        </div>
      )}

      <div className="session-swarm-stream">
        <GoalBanner conversationId={conversationId} />
        <PlanOverlay conversationId={conversationId} />
        <Transcript conversationId={conversationId} />
        {!archived && <ComposerContext conversationId={conversationId} />}
      </div>
      {archived ? (
        <div className="banner archived-readonly">
          <span>{t('session.archivedReadonly')}</span>
          <span className="spacer" />
          <Button
            label={t('sidebar.menu.unarchive')}
            size="sm"
            variant="secondary"
            onClick={() => void useSessionStore.getState().setArchived(conversationId, false)}
          />
        </div>
      ) : (
        <Composer conversationId={conversationId} />
      )}
    </div>
  )
}
