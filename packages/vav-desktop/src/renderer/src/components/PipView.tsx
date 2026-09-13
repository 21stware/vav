import { useEffect, useMemo } from 'react'
import { swarmChildrenOf } from '@shared/swarmLayout'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { flatten, listedSidebarGroups } from '../lib/grouping'
import {
  isSessionRunning as sessionTurnIsRunning,
  isSessionUnread as sessionTurnIsUnread,
  parseSidebarSessionFilter,
  pipSessionFilter,
  sessionUnreadBadge
} from '../lib/sidebarSessionFilter'
import { flattenSessionTitle } from '../lib/sidebarList'
import { middleTruncate } from '../lib/format'
import { useT } from '../i18n/useT'
import { EmptyState } from './ui'
import { AgentModeChrome } from './SessionDetail'
import { Composer } from './Composer'
import { ToolsPanel } from './ToolsPanel'

let pipDraftEnsure: Promise<void> | null = null

/** Blank selected session the dock can send from; otherwise mint one. */
function ensurePipComposerDraft(): Promise<void> {
  if (pipDraftEnsure) return pipDraftEnsure
  pipDraftEnsure = (async () => {
    try {
      const store = useSessionStore.getState()
      const id = store.activeId
      const row = id ? store.conversations.find((c) => c.id === id) : undefined
      const turn = id ? store.turns[id] : undefined
      const running = Boolean(
        id &&
          sessionTurnIsRunning({
            isRunning: turn?.isRunning,
            activity: store.activityById[id]
          })
      )
      const blank =
        Boolean(row) &&
        !row?.archived &&
        !running &&
        (store.messages[id!]?.length ?? 0) === 0
      if (blank) return
      await store.createConversation({ openIn: 'here' })
    } finally {
      pipDraftEnsure = null
    }
  })()
  return pipDraftEnsure
}

/**
 * Compact main-window shell: isolated-window chrome (no split) + the sidebar’s
 * Running / Done list. Composer + workbench stay pinned at the bottom so a
 * new conversation can be started without opening a task row.
 */
export function PipView(): React.JSX.Element {
  const t = useT()
  const conversations = useSessionStore((s) => s.conversations)
  const activeId = useSessionStore((s) => s.activeId)
  const query = useSessionStore((s) => s.sidebarQuery)
  const groupingMode = useSessionStore((s) => s.settings.sidebarGroupingMode)
  const sessionFilterRaw = useSessionStore((s) => s.settings.sidebarSessionFilter)
  const sessionFilter = parseSidebarSessionFilter(sessionFilterRaw)
  const favoriteIds = useSessionStore((s) => s.settings.favoriteConversationIds)
  const pinnedWorkspaces = useSessionStore((s) => s.settings.pinnedWorkspaceDirectories)
  const tmp = useSessionStore((s) => s.tmp)
  const windowMachineId = useSessionStore((s) => s.windowMachineId)
  const activityById = useSessionStore((s) => s.activityById)
  const turnBusyKey = useSessionStore((s) => {
    const parts: string[] = []
    for (const [id, turn] of Object.entries(s.turns)) {
      if (!turn?.isRunning && !turn?.awaitingToolCallId) continue
      parts.push(`${id}:${turn.phase}:${turn.awaitingToolCallId ? 'a' : 'r'}`)
    }
    return parts.join('|')
  })
  void turnBusyKey
  const turns = useSessionStore.getState().turns
  const shellBusyKey = useWorkspaceStore((s) => {
    const parts: string[] = []
    for (const [conversationId, tabs] of Object.entries(s.ptyStatus)) {
      if (!Object.values(tabs).some((status) => status === 'running')) continue
      parts.push(conversationId)
    }
    return parts.sort().join('|')
  })
  const shellBusy = useMemo(() => new Set(shellBusyKey ? shellBusyKey.split('|') : []), [shellBusyKey])
  const swarmEnabled = useSessionStore((s) => s.settings.swarmModeEnabled === true)
  const setPictureInPicture = useSessionStore((s) => s.setPictureInPicture)
  const conversation = useSessionStore((s) => s.conversations.find((c) => c.id === s.activeId))
  const agentBinaryName = conversation?.agentBinaryName ?? null
  const favoriteSet = useMemo(() => new Set(favoriteIds ?? []), [favoriteIds])

  useEffect(() => {
    void ensurePipComposerDraft()
  }, [])

  const isSessionRunning = (id: string): boolean => {
    const turn = turns[id]
    return sessionTurnIsRunning({
      isRunning: turn?.isRunning,
      activity: activityById[id],
      shellBusy: shellBusy.has(id)
    })
  }
  const isSessionUnread = (id: string): boolean => {
    const row = conversations.find((c) => c.id === id)
    const turn = turns[id]
    return sessionTurnIsUnread({
      awaitingToolCallId: turn?.awaitingToolCallId,
      isRunning: turn?.isRunning,
      activity: activityById[id],
      resultUnseen: row?.resultUnseen
    })
  }

  const groups = useMemo(
    () =>
      listedSidebarGroups(conversations, {
        fileSessionsView: false,
        archiveView: false,
        databasesView: false,
        query,
        windowMachineId,
        sessionFilter: pipSessionFilter(sessionFilter),
        running: isSessionRunning,
        unread: isSessionUnread,
        favoriteIds: favoriteSet,
        searching: query.trim().length > 0,
        groupingMode,
        tmp,
        pinnedWorkspaces
      }),
    [
      conversations,
      query,
      windowMachineId,
      sessionFilterRaw,
      favoriteSet,
      groupingMode,
      tmp,
      pinnedWorkspaces,
      turnBusyKey,
      shellBusyKey,
      activityById
    ]
  )

  const visible = useMemo(
    () =>
      flatten(groups, new Set(), (row) =>
        swarmEnabled ? swarmChildrenOf(conversations, row.id) : []
      ),
    [groups, conversations, swarmEnabled]
  )

  return (
    <div className="app-shell session-window pip-window" data-testid="pip-view">
      <header className="titlebar bare session-window-titlebar">
        <div className="session-window-titlebar-chrome">
          {activeId ? (
            <AgentModeChrome
              conversationId={activeId}
              agentBinaryName={agentBinaryName}
              showSearch={false}
              hideSplit
              trail={
                <button
                  type="button"
                  className="session-reveal-in-list"
                  title={t('session.fullMode')}
                  onClick={() => void setPictureInPicture(false)}
                >
                  {t('session.fullMode')}
                </button>
              }
            />
          ) : (
            <div className="agent-mode-chrome-row" id="sessionBar">
              <span className="spacer" />
              <div className="agent-mode-chrome-trailing">
                <button
                  type="button"
                  className="session-reveal-in-list"
                  title={t('session.fullMode')}
                  onClick={() => void setPictureInPicture(false)}
                >
                  {t('session.fullMode')}
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="pip-body">
        {visible.length === 0 ? (
          <EmptyState title={t('pip.emptyTitle')} description={t('pip.emptyDesc')} />
        ) : (
          <div className="pip-task-list">
            {groups.map((group) => {
              const showHeader = !!group.label && group.kind !== 'database'
              const rows = group.conversations.flatMap((row) => {
                const nested = swarmEnabled ? swarmChildrenOf(conversations, row.id) : []
                return [row, ...nested]
              })
              if (rows.length === 0) return null
              return (
                <div className="pip-task-group" key={group.key}>
                  {showHeader ? (
                    <div className="pip-task-group-label">{group.label}</div>
                  ) : null}
                  {rows.map((row) => {
                    const turn = turns[row.id]
                    const awaiting = !!turn?.awaitingToolCallId
                    const running = !!turn?.isRunning && !awaiting
                    const unreadBadge = sessionUnreadBadge(awaiting, running, activityById[row.id])
                    const title = flattenSessionTitle(row.title, t('common.untitledSession'))
                    return (
                      <div
                        key={row.id}
                        className="pip-task"
                        data-conversation-id={row.id}
                      >
                        <div className="pip-task-row" title={title}>
                          <span className="pip-task-title">{middleTruncate(title)}</span>
                          {unreadBadge === 'awaiting' && (
                            <span className="conv-badge awaiting" title={t('sidebar.badge.pending')} />
                          )}
                          {unreadBadge === 'done' && (
                            <span className="conv-badge done" title={t('sidebar.badge.done')} />
                          )}
                          {unreadBadge === 'failed' && (
                            <span className="conv-badge failed" title={t('sidebar.badge.failed')} />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="dock pip-dock" data-testid="pip-composer-dock">
        <Composer />
        <ToolsPanel />
      </div>
    </div>
  )
}
