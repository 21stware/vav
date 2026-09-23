import { useEffect, useMemo } from 'react'
import { MessageSquare, MessageSquarePlus } from 'lucide-react'
import { isWorkspaceSession } from '@shared/sessionKind'
import { conversationOnMachine } from '@shared/workspaceHost'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { relativeTime } from '../lib/format'
import { PENDING_COMPOSER_ID } from '../lib/pendingComposer'
import { useShowShellLeading } from '../lib/sidebarLayout'
import { APP_NAV } from '../lib/appNav'
import { ShellLeadingControls } from './ShellLeadingControls'
import { Composer, ComposerContext } from './Composer'
import { WorkbenchHomeInsights } from './WorkbenchHomeInsights'

const RECENT_LIMIT = 20

export function WorkbenchHome(): React.JSX.Element {
  const t = useT()
  const showShellLeading = useShowShellLeading()
  const setApplicationsMode = useSessionStore((s) => s.setApplicationsMode)
  const beginNewSession = useSessionStore((s) => s.beginNewSession)
  const selectConversation = useSessionStore((s) => s.selectConversation)
  const conversations = useSessionStore((s) => s.conversations)
  const windowMachineId = useSessionStore((s) => s.windowMachineId)
  const sessions = useMemo(
    () =>
      conversations
        .filter(
          (row) =>
            isWorkspaceSession(row) &&
            !row.archived &&
            conversationOnMachine(row, windowMachineId)
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, RECENT_LIMIT),
    [conversations, windowMachineId]
  )
  const empty = sessions.length === 0
  const focusComposer = useSessionStore((s) => s.focusComposer)

  useEffect(() => {
    focusComposer(PENDING_COMPOSER_ID)
  }, [focusComposer])

  return (
    <div
      className="workbench-home"
      data-testid="workbench-home"
      data-empty={empty ? 'true' : 'false'}
    >
      {showShellLeading ? (
        <header className="workbench-home-chrome">
          <ShellLeadingControls />
        </header>
      ) : null}
      <div className="workbench-home-body">
        <div className="workbench-home-stage">
          <WorkbenchHomeInsights />
          <nav className="workbench-home-nav" data-testid="workbench-home-nav">
            <button
              type="button"
              className="workbench-home-nav-item is-primary"
              data-testid="home-new-session"
              onClick={() => beginNewSession()}
            >
              <span className="workbench-home-nav-icon" aria-hidden>
                <MessageSquarePlus size={16} strokeWidth={2} />
              </span>
              <span>{t('common.newSession')}</span>
            </button>
            {APP_NAV.map((item) => {
              const Icon = item.Icon
              const label = t(item.labelKey)
              return (
                <button
                  type="button"
                  key={item.mode}
                  className="workbench-home-nav-item"
                  data-testid={`home-nav-${item.mode}`}
                  onClick={() => setApplicationsMode(item.mode)}
                >
                  <span className="workbench-home-nav-icon" aria-hidden>
                    <Icon size={16} strokeWidth={2} />
                  </span>
                  <span>{label}</span>
                </button>
              )
            })}
          </nav>
          <div className="workbench-home-composer" data-testid="workbench-home-composer">
            <ComposerContext conversationId={PENDING_COMPOSER_ID} />
            <Composer conversationId={PENDING_COMPOSER_ID} variant="home" />
          </div>
          <section className="workbench-home-sessions" data-testid="workbench-home-sessions">
            <h2 className="workbench-home-sessions-title">{t('workbench.home.recentSessions')}</h2>
            {empty ? (
              <p className="workbench-home-sessions-empty">{t('preview.sessionHistoryEmptyTitle')}</p>
            ) : (
              <ul className="workbench-home-session-list">
                {sessions.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="workbench-home-session"
                      data-testid="home-session-row"
                      data-conversation-id={row.id}
                      onClick={() => void selectConversation(row.id)}
                    >
                      <span className="workbench-home-session-icon" aria-hidden>
                        <MessageSquare size={13} strokeWidth={1.8} />
                      </span>
                      <span className="workbench-home-session-title">{row.title}</span>
                      <span className="workbench-home-session-meta">{relativeTime(row.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
