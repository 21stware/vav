import { Suspense, lazy, type RefObject } from 'react'
import { Clock, Plus } from 'lucide-react'
import type { ConversationMeta } from '@shared/types'
import type { FileSessionMeta } from '@shared/ipc'
import { clampPanelWidth, persistPanelWidth } from '../../lib/fileViewerHelpers'
import { Button, EmptyState } from '../ui'
import { SessionHistoryPopover } from '../SessionHistoryPopover'
import type { FileSessionChromeProps } from '../SessionDetail'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'

const SessionDetail = lazy(() =>
  import('../SessionDetail').then((m) => ({ default: m.SessionDetail }))
)

export function FileViewerAgentColumn({
  panelWidth,
  panelWidthRef,
  setPanelWidth,
  conversations,
  agentConversationId,
  embedded,
  sessionTitle,
  fileSessions,
  historyOpen,
  setHistoryOpen,
  historyAnchorRef,
  switchFileSession,
  renameFileSession,
  deleteFileSessions,
  newFileSession,
  ensureFileSession
}: {
  panelWidth: number
  panelWidthRef: { current: number }
  setPanelWidth: (width: number) => void
  conversations: ConversationMeta[]
  agentConversationId: string | null
  embedded: boolean
  sessionTitle: string
  fileSessions: FileSessionMeta[]
  historyOpen: boolean
  setHistoryOpen: (open: boolean | ((v: boolean) => boolean)) => void
  historyAnchorRef: RefObject<HTMLButtonElement | null>
  switchFileSession: (id: string) => Promise<unknown> | unknown
  renameFileSession: (id: string, title: string) => Promise<void>
  deleteFileSessions: (ids: string[]) => void
  newFileSession: () => Promise<unknown> | unknown
  ensureFileSession: () => Promise<string | undefined | null>
}): React.JSX.Element {
  const t = useT()
  const agentMeta = conversations.find((c) => c.id === agentConversationId)
  const agentIsVav = !agentMeta?.agentBinaryName || agentMeta.agentBinaryName === 'vav'
  const showSeparateSessionBar = !embedded && (!agentConversationId || !agentIsVav)
  const fileChrome: FileSessionChromeProps | null =
    agentConversationId && agentIsVav
      ? {
          title: sessionTitle,
          sessions: fileSessions,
          activeSessionId: agentConversationId,
          historyOpen,
          historyAnchorRef,
          onToggleHistory: () => setHistoryOpen((v) => !v),
          onCloseHistory: () => setHistoryOpen(false),
          onSwitchSession: (id) => void switchFileSession(id),
          onRenameSession: renameFileSession,
          onDeleteSessions: deleteFileSessions,
          onNewSession: () => void newFileSession()
        }
      : null

  return (
    <aside className="preview-agent-panel" style={{ width: panelWidth }}>
      <div
        className="preview-agent-resizer"
        onMouseDown={(event) => {
          event.preventDefault()
          const startX = event.clientX
          const startW = panelWidth
          const onMove = (e: MouseEvent): void => {
            const next = clampPanelWidth(startW + (startX - e.clientX))
            panelWidthRef.current = next
            setPanelWidth(next)
          }
          const onUp = (): void => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            try {
              persistPanelWidth(panelWidthRef.current)
            } catch {
              // ignore
            }
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
        }}
      />
      {showSeparateSessionBar && (
        <div className="preview-file-session-bar">
          <span className="preview-file-session-title" title={sessionTitle}>
            {sessionTitle || t('common.session')}
          </span>
          <span className="spacer" />
          <div className="preview-file-session-actions">
            <button
              type="button"
              ref={historyAnchorRef}
              className={`btn ghost sm icon-only${historyOpen ? ' is-active-toggle' : ''}`}
              title={t('preview.sessionHistory')}
              onClick={() => setHistoryOpen((v) => !v)}
            >
              <Clock size={12} />
            </button>
            <Button
              icon={<Plus size={12} />}
              size="sm"
              variant="ghost"
              title={t('preview.newSession')}
              onClick={() => void newFileSession()}
            />
          </div>
          <SessionHistoryPopover
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            sessions={fileSessions}
            activeSessionId={agentConversationId}
            onSwitch={(id) => {
              void switchFileSession(id)
              setHistoryOpen(false)
            }}
            onRename={renameFileSession}
            onDelete={deleteFileSessions}
            anchorRef={historyAnchorRef}
          />
        </div>
      )}
      {agentConversationId ? (
        <Suspense fallback={<div className="muted" data-pad="text" />}>
          <SessionDetail variant="preview-edit" fileSessionChrome={fileChrome} />
        </Suspense>
      ) : (
        <EmptyState title={t('preview.startChat')} description={t('preview.startChatDesc')}>
          <Button
            label={t('preview.startChat')}
            size="sm"
            variant="primary"
            onClick={() => {
              void ensureFileSession().then((id) => {
                if (id) useSessionStore.getState().focusComposer()
              })
            }}
          />
        </EmptyState>
      )}
    </aside>
  )
}
