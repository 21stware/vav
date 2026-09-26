import {
  useEffect,
  useMemo,
  type ReactNode,
  type RefObject
} from 'react'
import { Clock, Plus, Search, X } from 'lucide-react'
import type { FileSessionMeta } from '@shared/ipc'
import { findNeighborPane, focusedCliPaneId, measureCliPaneRects } from '../lib/cliPaneNavigate'
import { resolveUiFocusScope } from '../lib/uiFocus'
import { useSessionStore } from '../state/sessionStore'
import { SessionHistoryPopover } from './SessionHistoryPopover'
import { ToolsPanel } from './ToolsPanel'
import { Composer, ComposerContext } from './Composer'
import { Transcript } from './Transcript'
import { SearchStrip } from './SearchStrip'
import { PlanOverlay } from './PlanOverlay'
import { GoalBanner } from './GoalBanner'
import { ErrorBanner } from './ErrorBanner'
import { Button } from './ui'
import { ShellLeadingControls } from './ShellLeadingControls'
import { SwarmSplitView } from './SwarmSplitView'
import { collectSwarmLeaves, swarmLeaf, swarmRootId } from '@shared/swarmLayout'
import { useConversationFileDrop } from '../lib/useConversationFileDrop'
import { parkTerminal } from '../lib/terminalRegistry'
import { useT } from '../i18n/useT'
import { matchingKeyBindingId, prettyAccelerator, resolveKeyBindings } from '@shared/keyBindings'
import { PLATFORM } from '../lib/platform'
import { useShowShellLeading } from '../lib/sidebarLayout'
import { isCompanionSessionShell } from '../lib/windowKind'
import { useWorkspaceStore } from '../state/workspaceStore'

/**
 * - `main`: full session surface (sidebar → open conversation)
 * - `workspace`: agent column inside WorkspaceView
 * - `preview-edit`: file-preview agent drawer
 */
type SessionDetailVariant = 'main' | 'workspace' | 'preview-edit'

/**
 * Session chrome folded into the agent row (file-preview vav, or workspace).
 * Optional `trail` is for workspace-only controls (e.g. preview drawer toggle).
 */
export type FileSessionChromeProps = {
  title: string
  sessions: FileSessionMeta[]
  activeSessionId: string | null
  historyOpen: boolean
  historyAnchorRef: RefObject<HTMLButtonElement | null>
  onToggleHistory: () => void
  onCloseHistory: () => void
  onSwitchSession: (id: string) => void
  onRenameSession: (id: string, title: string) => Promise<void>
  onDeleteSessions: (ids: string[]) => void
  onNewSession: () => void
  /** Trailing controls after search (workspace preview toggle, etc.). */
  trail?: ReactNode
}

/**
 * Session surface: transcript + tools + composer, with optional GUI swarm split.
 */
export function SessionDetail({
  variant = 'main',
  fileSessionChrome,
  /** Companion session window: chrome lives in the title bar, not under it. */
  hideChrome = false
}: {
  variant?: SessionDetailVariant
  /** File-preview / workspace: session name / history / new in the agent row. */
  fileSessionChrome?: FileSessionChromeProps | null
  hideChrome?: boolean
}): React.JSX.Element {
  const t = useT()
  const searchOpen = useSessionStore((s) => s.search.open)
  const errorBanner = useSessionStore((s) => s.errorBanner)
  const errorBannerKind = useSessionStore((s) => s.errorBannerKind)
  const setErrorBanner = useSessionStore((s) => s.setErrorBanner)
  const openSettings = useSessionStore((s) => s.openSettings)
  const activeId = useSessionStore((s) => s.activeId)
  const conversation = useSessionStore((s) => s.conversations.find((c) => c.id === s.activeId))
  const setArchived = useSessionStore((s) => s.setArchived)
  const archived = !!conversation?.archived
  const settings = useSessionStore((s) => s.settings)
  const pending = useSessionStore((s) => s.pendingReviewByConversation[s.activeId])
  const openChangeReview = useSessionStore((s) => s.openChangeReview)
  const detachedElsewhere = useSessionStore(
    (s) =>
      !isCompanionSessionShell() &&
      s.detachedConversationIds.includes(s.activeId)
  )

  const previewEdit = variant === 'preview-edit'
  const isKeyProblem = !!errorBanner && /401|API Key/i.test(errorBanner)
  const isQuotaProblem = errorBannerKind === 'quota'

  const agentKey = conversation?.agentBinaryName ?? null
  const swarmEnabled = useSessionStore((s) => s.settings.swarmModeEnabled === true)
  const conversations = useSessionStore((s) => s.conversations)
  const swarmRoot = conversation
    ? swarmRootId(conversation.id, conversation.swarmParentId)
    : activeId
  const swarmLayout =
    conversations.find((c) => c.id === swarmRoot)?.swarmLayout ??
    (swarmRoot ? swarmLeaf(swarmRoot) : null)
  const swarmLeaves = collectSwarmLeaves(swarmLayout)
  const swarmMulti = swarmEnabled && swarmLeaves.length > 1
  const threadSplit = swarmEnabled === true
  const showAgentSwitcher = true

  useEffect(() => {
    if (!swarmMulti) return
    for (const id of swarmLeaves) {
      const meta = useSessionStore.getState().conversations.find((c) => c.id === id)
      void useWorkspaceStore.getState().bindConversation(id, meta?.workingDirectory ?? null)
      if (!useSessionStore.getState().messages[id]) {
        void useSessionStore.getState().loadMessages(id)
      }
    }
  }, [swarmMulti, swarmLeaves.join('|')])

  const bindings = useMemo(
    () => resolveKeyBindings(settings.keyBindings),
    [settings.keyBindings]
  )

  // Swarm-on Thread uses remappable split + spatial pane focus (defaults ⌘D / ⌘⇧D / ⌘⇧←↑↓→).
  useEffect(() => {
    if (!threadSplit) return
    const onKey = (event: KeyboardEvent): void => {
      const hit = matchingKeyBindingId(event, bindings, PLATFORM)
      const paneDir =
        hit === 'focusPaneLeft'
          ? 'left'
          : hit === 'focusPaneRight'
            ? 'right'
            : hit === 'focusPaneUp'
              ? 'up'
              : hit === 'focusPaneDown'
                ? 'down'
                : null
      if (paneDir && swarmMulti) {
        const panes = measureCliPaneRects(document.querySelector('.session-swarm-split'))
        if (panes.length >= 2) {
          const focused = focusedCliPaneId(document.querySelector('.session-swarm-split'))
          const from =
            (focused && panes.some((p) => p.tabId === focused) ? focused : null) ||
            (activeId && panes.some((p) => p.tabId === activeId) ? activeId : null) ||
            panes[0]?.tabId ||
            ''
          if (from) {
            const next = findNeighborPane(from, paneDir, panes)
            event.preventDefault()
            event.stopPropagation()
            if (next && next !== from) void useSessionStore.getState().selectConversation(next)
            return
          }
        }
      }
      if (paneDir) return

      if (hit !== 'splitPaneRight' && hit !== 'splitPaneDown') return
      const live = resolveUiFocusScope(document.activeElement)
      if (live === 'bash') return
      event.preventDefault()
      const axis = hit === 'splitPaneDown' ? 'column' : 'row'
      void useSessionStore.getState().splitSwarmPane(axis)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [activeId, previewEdit, threadSplit, swarmMulti, bindings])

  // Companion window owns PTY geometry. Soft-park main's xterm (detach DOM,
  // keep buffer + live sink) so reclaim is instant when the companion closes.
  useEffect(() => {
    if (!detachedElsewhere || !activeId) return
    const ws = useWorkspaceStore.getState().workspaces[activeId]
    for (const host of Object.values(ws?.agentHostSessions ?? {})) {
      for (const tab of host.tabs) {
        parkTerminal(activeId, tab.id)
      }
    }
  }, [detachedElsewhere, activeId])

  const shellLeading = useShowShellLeading()
  const showShellLeading = (variant === 'main' || variant === 'workspace') && shellLeading

  const chromeSession =
    variant === 'workspace' || previewEdit ? (fileSessionChrome ?? null) : null

  const chrome =
    showAgentSwitcher && !hideChrome ? (
      <AgentModeChrome
        conversationId={activeId}
        agentBinaryName={agentKey}
        showSearch
        showShellLeading={showShellLeading}
        fileSessionChrome={chromeSession}
        onClose={
          variant === 'main' && !isCompanionSessionShell()
            ? () => useSessionStore.getState().setAgentVisible(false)
            : undefined
        }
      />
    ) : null

  const shellClass = [
    previewEdit ? 'preview-edit-session' : 'detail',
    swarmMulti ? 'is-swarm-multi' : '',
    variant === 'workspace' ? 'session-detail-workspace' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const streamClass = previewEdit ? 'preview-edit-stream' : 'detail-stream'
  const toolsVariant = previewEdit ? 'preview-edit' : 'main'

  const { dropActive, dropHandlers } = useConversationFileDrop(
    activeId,
    !archived && !swarmMulti && !detachedElsewhere
  )

  return (
    <main className={shellClass} data-testid="session-detail" {...dropHandlers}>
      {dropActive && (
        <div className="session-drop-overlay" aria-hidden="true">
          <div className="session-drop-hint">{t('composer.dropFiles')}</div>
        </div>
      )}
      {chrome}
      {errorBanner && (
        <ErrorBanner
          message={errorBanner}
          actionLabel={
            isQuotaProblem
              ? t('error.viewQuota')
              : isKeyProblem
                ? t('error.openSettings')
                : undefined
          }
          onAction={
            isQuotaProblem
              ? () => {
                  if (!activeId) return
                  const el = document.querySelector('.banner.error')
                  const rect = el?.getBoundingClientRect()
                  void window.vav.window.openTokenUsage(
                    activeId,
                    rect
                      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                      : undefined
                  )
                }
              : isKeyProblem
                ? () => openSettings('agents', 'vav')
                : undefined
          }
          onDismiss={() => setErrorBanner(null)}
        />
      )}

      {!previewEdit && pending && pending.count > 0 && (
        <div className="banner review-pending">
          <span>{t('review.pendingBanner', { n: pending.count })}</span>
          <span className="spacer" />
          <Button
            label={t('review.openReview')}
            size="sm"
            variant="primary"
            onClick={() => {
              document
                .getElementById(`inline-review-${pending.changeSetId}`)
                ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              void openChangeReview(pending.changeSetId)
            }}
          />
        </div>
      )}

      {swarmMulti && swarmLayout && !previewEdit ? (
        <>
          {searchOpen && <SearchStrip />}
          <SwarmSplitView rootId={swarmRoot} layout={swarmLayout} compact />
        </>
      ) : (
        <div className="session-surfaces">
          <div className={streamClass} data-search={searchOpen}>
            {searchOpen && <SearchStrip />}
            {!previewEdit && <GoalBanner />}
            {!previewEdit && <PlanOverlay />}
            <Transcript logId="transcript" />
            {!archived && <ComposerContext conversationId={activeId} />}
          </div>
        </div>
      )}

      <div
        className={`dock${previewEdit ? ' preview-edit-dock' : ''}${
          swarmMulti ? ' dock-tools-only' : ''
        }`}
      >
        {swarmMulti ? null : archived ? (
          <div className="banner archived-readonly">
            <span>{t('session.archivedReadonly')}</span>
            <span className="spacer" />
            <Button
              label={t('sidebar.menu.unarchive')}
              size="sm"
              variant="secondary"
              onClick={() => void setArchived(activeId, false)}
            />
          </div>
        ) : (
          <Composer conversationId={activeId} />
        )}
        <ToolsPanel variant={toolsVariant} />
      </div>
    </main>
  )
}

/**
 * Agent chrome: VAV built-in | structured CLI host.
 */
export function AgentModeChrome({
  conversationId: _conversationId,
  agentBinaryName: _agentBinaryName,
  showSearch = true,
  showShellLeading = false,
  fileSessionChrome = null,
  trail = null,
  showNewSession = false,
  onClose
}: {
  conversationId: string
  agentBinaryName: string | null
  showSearch?: boolean
  showShellLeading?: boolean
  fileSessionChrome?: FileSessionChromeProps | null
  trail?: ReactNode
  showNewSession?: boolean
  /** Unused: split actions moved to the empty-area context menu. */
  hideSplit?: boolean
  onClose?: () => void
}): React.JSX.Element {
  const t = useT()
  const keyBindings = useSessionStore((s) => s.settings.keyBindings)
  const bindings = resolveKeyBindings(keyBindings)
  void _agentBinaryName

  const searchOpen = useSessionStore((s) => s.search.open)
  const openSearch = useSessionStore((s) => s.openSearch)
  const closeSearch = useSessionStore((s) => s.closeSearch)
  const fs = fileSessionChrome

  const showFileSessionChrome = !!(fs && fs.sessions.length > 0)
  const trailing = fs?.trail ?? trail
  const showTrailing =
    showFileSessionChrome ||
    showSearch ||
    showNewSession ||
    !!trailing ||
    !!onClose

  return (
    <div
      className={`terminal-host-chrome agent-mode-chrome${showFileSessionChrome ? ' has-file-session' : ''}${showShellLeading ? ' has-shell-leading' : ''}`}
    >
      <div className="agent-mode-chrome-row" id="sessionBar">
        {showShellLeading ? (
          <div className="agent-mode-shell-leading">
            <ShellLeadingControls />
          </div>
        ) : null}

        {showFileSessionChrome ? (
          <span className="agent-mode-session-title" title={fs!.title}>
            {fs!.title || t('common.session')}
          </span>
        ) : null}

        <span className="spacer" />

        {showTrailing ? (
          <div className="agent-mode-chrome-trailing">
            {showFileSessionChrome ? (
              <div className="agent-mode-file-actions">
                <button
                  type="button"
                  ref={fs!.historyAnchorRef}
                  className={`btn ghost icon-only${fs!.historyOpen ? ' is-active-toggle' : ''}`}
                  title={t('preview.sessionHistory')}
                  onClick={fs!.onToggleHistory}
                >
                  <Clock size={14} />
                </button>
                <Button
                  icon={<Plus size={14} />}
                  variant="ghost"
                  title={t('preview.newSession')}
                  onClick={fs!.onNewSession}
                />
              </div>
            ) : null}

            {showNewSession ? (
              <Button
                icon={<Plus size={14} />}
                variant="ghost"
                testId="session-window-new-session"
                title={t('app.newSessionTitle', {
                  shortcut: prettyAccelerator(bindings.newSession, PLATFORM)
                })}
                onClick={() => useSessionStore.getState().beginNewSession()}
              />
            ) : null}

            {showSearch ? (
              <Button
                icon={<Search size={14} />}
                variant="ghost"
                testId="session-search"
                title={`${t('common.search')} ${prettyAccelerator(bindings.find, PLATFORM)}`}
                onClick={() => (searchOpen ? closeSearch() : openSearch())}
              />
            ) : null}

            {trailing ? <div className="agent-mode-chrome-trail">{trailing}</div> : null}

            {onClose ? (
              <Button
                icon={<X size={15} strokeWidth={2} />}
                variant="ghost"
                testId="close-agent"
                title={t('agent.close')}
                onClick={onClose}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {showFileSessionChrome ? (
        <SessionHistoryPopover
          open={fs!.historyOpen}
          onClose={fs!.onCloseHistory}
          sessions={fs!.sessions}
          activeSessionId={fs!.activeSessionId}
          onSwitch={(id) => {
            fs!.onSwitchSession(id)
            fs!.onCloseHistory()
          }}
          onRename={fs!.onRenameSession}
          onDelete={fs!.onDeleteSessions}
          anchorRef={fs!.historyAnchorRef}
        />
      ) : null}
    </div>
  )
}
