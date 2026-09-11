import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Pin, Star } from 'lucide-react'
import type { ConversationMeta } from '@shared/types'
import type { TimerJob, TimerRun } from '@shared/timer'
import { useSessionStore } from '../../state/sessionStore'
import { isDroppedConversationId, replaceTimerSessions } from '../../state/sessionListMerge'
import { timerListConversationIds, timerScheduleLabel, timerSessionsForJob } from '../../lib/timerSessions'
import { flattenSessionTitle, adjacentRunClass } from '../../lib/sidebarList'
import { relativeTime, middleTruncate } from '../../lib/format'
import { showMenu, type MenuItem } from '../../lib/nativeMenu'
import { lucideMenuIcon } from '../../lib/menuIcons'
import { useT } from '../../i18n/useT'
import { RenameField } from './RenameField'
import { ConvBracket, type SwarmBracketKind } from './ConvBracket'

function runStatusLabel(status: TimerRun['status'], t: ReturnType<typeof useT>): string {
  if (status === 'running') return t('timer.runRunning')
  if (status === 'done') return t('timer.runDone')
  if (status === 'failed') return t('timer.runFailed')
  return t('timer.runSkipped')
}

export function TimerJobsPanel(): React.JSX.Element {
  const t = useT()
  const createScheduledConversation = useSessionStore((s) => s.createScheduledConversation)
  const selectConversation = useSessionStore((s) => s.selectConversation)
  const requestDelete = useSessionStore((s) => s.requestDelete)
  const beginRename = useSessionStore((s) => s.beginRename)
  const renameConversation = useSessionStore((s) => s.renameConversation)
  const setPinned = useSessionStore((s) => s.setPinned)
  const setFavorite = useSessionStore((s) => s.setFavorite)
  const setArchived = useSessionStore((s) => s.setArchived)
  const showToast = useSessionStore((s) => s.showToast)
  const conversations = useSessionStore((s) => s.conversations)
  const activeId = useSessionStore((s) => s.activeId)
  const selectedIds = useSessionStore((s) => s.selectedIds)
  const favoriteIds = useSessionStore((s) => s.settings.favoriteConversationIds)
  const renamingId = useSessionStore((s) => s.renamingId)
  const favoriteSet = useMemo(() => new Set(favoriteIds ?? []), [favoriteIds])
  const [jobs, setJobs] = useState<TimerJob[]>([])
  const [runs, setRuns] = useState<TimerRun[]>([])
  const [archivedOpen, setArchivedOpen] = useState<Set<string>>(() => new Set())
  const refreshGen = useRef(0)
  const weekday = (day: number): string => t(`timer.weekday.${day}` as 'timer.weekday.0')

  const hydrateSessions = useCallback(async (): Promise<void> => {
    if (!window.vav?.timers?.listSessions) return
    const sessions = await window.vav.timers.listSessions()
    useSessionStore.setState((state) => ({
      conversations: replaceTimerSessions(state.conversations, sessions)
    }))
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (!window.vav?.timers) return
    const gen = ++refreshGen.current
    try {
      const [nextJobs, nextRuns] = await Promise.all([
        window.vav.timers.listJobs(),
        window.vav.timers.listRuns()
      ])
      if (gen !== refreshGen.current) return
      setJobs(nextJobs)
      setRuns(nextRuns)
      await hydrateSessions()
      if (gen !== refreshGen.current) return
      if (nextJobs.length === 0) void createScheduledConversation()
    } catch {
      if (gen !== refreshGen.current) return
      setJobs([])
      setRuns([])
    }
  }, [createScheduledConversation, hydrateSessions])

  useEffect(() => {
    void refresh()
    return window.vav.timers?.onChanged(() => {
      void refresh()
    })
  }, [refresh])

  const visibleJobs = useMemo(
    () =>
      jobs.filter((job) => {
        if (!job.conversationId) return true
        if (conversations.some((row) => row.id === job.conversationId)) return true
        return !isDroppedConversationId(job.conversationId)
      }),
    [jobs, conversations]
  )

  const orderedIds = useMemo(
    () => timerListConversationIds(visibleJobs, conversations),
    [visibleJobs, conversations]
  )

  const openJob = async (job: TimerJob): Promise<void> => {
    if (job.conversationId) {
      await selectConversation(job.conversationId)
      return
    }
    showToast({ kind: 'info', title: t('timer.openFailed') })
  }

  const removeJob = async (job: TimerJob): Promise<void> => {
    if (job.conversationId && conversations.some((row) => row.id === job.conversationId)) {
      requestDelete([job.conversationId])
      return
    }
    await window.vav.timers?.removeJob(job.id)
    if (job.conversationId) {
      try {
        await window.vav.conversations.remove([job.conversationId])
      } catch {
        // Conversation may already be gone.
      }
    }
    await refresh()
  }

  const sessionMenu = (targets: ConversationMeta[]): MenuItem[] => {
    if (targets.length === 0) return []
    const ids = targets.map((row) => row.id)
    const allPinned = targets.every((row) => row.pinned)
    const allFavorite = targets.every((row) => favoriteSet.has(row.id))
    const allArchived = targets.every((row) => row.archived)
    if (targets.length > 1) {
      return [
        {
          label: allPinned
            ? t('sidebar.menu.unpinCount', { count: targets.length })
            : t('sidebar.menu.pinCount', { count: targets.length }),
          icon: lucideMenuIcon('pin'),
          onSelect: () => {
            void (async () => {
              for (const row of targets) await setPinned(row.id, !allPinned)
            })()
          }
        },
        {
          label: allFavorite
            ? t('sidebar.menu.unfavoriteCount', { count: targets.length })
            : t('sidebar.menu.favoriteCount', { count: targets.length }),
          icon: lucideMenuIcon('star'),
          onSelect: () => {
            void (async () => {
              for (const row of targets) await setFavorite(row.id, !allFavorite)
            })()
          }
        },
        {
          label: allArchived
            ? t('sidebar.menu.unarchiveCount', { count: targets.length })
            : t('sidebar.menu.archiveCount', { count: targets.length }),
          onSelect: () => {
            void (async () => {
              for (const row of targets) await setArchived(row.id, !allArchived)
            })()
          }
        },
        { label: '', divider: true },
        {
          label: t('sidebar.menu.deleteCount', { count: targets.length }),
          icon: lucideMenuIcon('trash-2'),
          destructive: true,
          onSelect: () => requestDelete(ids)
        }
      ]
    }
    const row = targets[0]!
    return [
      {
        label: row.pinned ? t('sidebar.menu.unpin') : t('sidebar.menu.pin'),
        icon: lucideMenuIcon('pin'),
        onSelect: () => void setPinned(row.id, !row.pinned)
      },
      {
        label: favoriteSet.has(row.id) ? t('sidebar.menu.unfavorite') : t('sidebar.menu.favorite'),
        icon: lucideMenuIcon('star'),
        onSelect: () => void setFavorite(row.id, !favoriteSet.has(row.id))
      },
      {
        label: row.archived ? t('sidebar.menu.unarchive') : t('sidebar.menu.archive'),
        onSelect: () => void setArchived(row.id, !row.archived)
      },
      {
        label: t('sidebar.menu.rename'),
        icon: lucideMenuIcon('pencil'),
        onSelect: () => beginRename(row.id)
      },
      { label: '', divider: true },
      {
        label: t('sidebar.menu.delete'),
        icon: lucideMenuIcon('trash-2'),
        destructive: true,
        onSelect: () => requestDelete([row.id])
      }
    ]
  }

  const renderSession = (
    conversation: ConversationMeta,
    run: TimerRun | undefined,
    swarmBracket?: SwarmBracketKind
  ): React.JSX.Element => {
    const isActive = conversation.id === activeId
    const isMultiSelected = selectedIds.length > 1 && selectedIds.includes(conversation.id)
    const index = orderedIds.indexOf(conversation.id)
    const prevMulti = index > 0 && selectedIds.includes(orderedIds[index - 1]!)
    const nextMulti = index >= 0 && index < orderedIds.length - 1 && selectedIds.includes(orderedIds[index + 1]!)
    const runClass = isMultiSelected ? adjacentRunClass(prevMulti, nextMulti) : ''
    const title = flattenSessionTitle(conversation.title)
    const sub = run
      ? `${runStatusLabel(run.status, t)} · ${relativeTime(run.startedAt)}`
      : relativeTime(conversation.timerRunAt ?? conversation.updatedAt)
    return (
      <div
        key={conversation.id}
        className={`conv-row${isActive ? ' selected' : ''}${isMultiSelected ? ` multi ${runClass}` : ''}${
          conversation.archived ? ' is-archived' : ''
        }${swarmBracket ? ' is-swarm-item' : ''}${swarmBracket === 'first' ? ' is-swarm-parent' : ''}${
          swarmBracket && swarmBracket !== 'first' ? ' is-swarm-child' : ''
        }`}
        data-testid="timer-session-row"
        data-conversation-id={conversation.id}
        title={title}
        onClick={(event) => {
          if (event.detail > 1) return
          void selectConversation(conversation.id, {
            additive: event.metaKey || event.ctrlKey,
            range: event.shiftKey,
            rangeIds: orderedIds
          })
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          const targets =
            selectedIds.length > 1 && selectedIds.includes(conversation.id)
              ? conversations.filter((row) => selectedIds.includes(row.id))
              : [conversation]
          if (targets.length === 1 && selectedIds.length > 1) {
            void selectConversation(conversation.id)
          }
          void showMenu(sessionMenu(targets))
        }}
      >
        {swarmBracket ? <ConvBracket kind={swarmBracket} /> : null}
        {renamingId === conversation.id ? (
          <RenameField
            initial={conversation.title}
            onCommit={(next) => void renameConversation(conversation.id, next)}
            onCancel={() => beginRename(null)}
          />
        ) : (
          <span className="conv-text">
            <span className="conv-title">{middleTruncate(title)}</span>
            <span className="conv-subtitle">
              <span className="conv-subtitle-text">{sub}</span>
            </span>
          </span>
        )}
        {renamingId !== conversation.id && (
          <>
            <button
              type="button"
              className={`conv-star-hit${favoriteSet.has(conversation.id) ? ' favorited' : ''}`}
              title={
                favoriteSet.has(conversation.id)
                  ? t('sidebar.menu.unfavorite')
                  : t('sidebar.menu.favorite')
              }
              aria-pressed={favoriteSet.has(conversation.id)}
              onClick={(event) => {
                event.stopPropagation()
                void setFavorite(conversation.id, !favoriteSet.has(conversation.id))
              }}
            >
              <Star size={10} strokeWidth={1.75} aria-hidden />
            </button>
            <button
              type="button"
              className={`conv-pin-hit${conversation.pinned ? ' pinned' : ''}`}
              title={conversation.pinned ? t('sidebar.menu.unpin') : t('sidebar.menu.pin')}
              aria-pressed={!!conversation.pinned}
              onClick={(event) => {
                event.stopPropagation()
                void setPinned(conversation.id, !conversation.pinned)
              }}
            >
              <Pin size={10} strokeWidth={1.75} aria-hidden />
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="timer-jobs" data-testid="timer-jobs">
      {visibleJobs.map((job) => {
        const definition = job.conversationId
          ? conversations.find((row) => row.id === job.conversationId)
          : undefined
        const { live, archived } = timerSessionsForJob(conversations, job.id)
        const jobRuns = runs.filter((run) => run.jobId === job.id)
        const unmatched = jobRuns.filter(
          (run) => !conversations.some((row) => row.id === run.conversationId)
        )
        const jobActive = job.conversationId === activeId
        const showArchived = archivedOpen.has(job.id)
        const hasTree =
          live.length + unmatched.length > 0 || (showArchived && archived.length > 0)
        const title = flattenSessionTitle(definition?.title || job.title)
        const sub = [
          timerScheduleLabel(job.schedule, weekday),
          job.enabled ? t('timer.enabled') : null,
          job.nextRunAt ? relativeTime(job.nextRunAt) : null
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <div key={job.id} data-testid={`timer-job-${job.id}`}>
            <div
              className={`conv-row${jobActive ? ' selected' : ''}${
                hasTree ? ' is-swarm-item is-swarm-parent' : ''
              }`}
              data-conversation-id={job.conversationId ?? undefined}
              title={title}
              onClick={(event) => {
                if (event.detail > 1) return
                if (job.conversationId) {
                  void selectConversation(job.conversationId, {
                    additive: event.metaKey || event.ctrlKey,
                    range: event.shiftKey,
                    rangeIds: orderedIds
                  })
                  return
                }
                void openJob(job)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (definition) {
                  const targets =
                    selectedIds.length > 1 && selectedIds.includes(definition.id)
                      ? conversations.filter((row) => selectedIds.includes(row.id))
                      : [definition]
                  void showMenu(sessionMenu(targets))
                  return
                }
                void showMenu([
                  {
                    label: t('sidebar.menu.delete'),
                    icon: lucideMenuIcon('trash-2'),
                    destructive: true,
                    onSelect: () => void removeJob(job)
                  }
                ])
              }}
            >
              {hasTree ? <ConvBracket kind="first" /> : null}
              {definition && renamingId === definition.id ? (
                <RenameField
                  initial={definition.title}
                  onCommit={(next) => void renameConversation(definition.id, next)}
                  onCancel={() => beginRename(null)}
                />
              ) : (
                <span className="conv-text">
                  <span className="conv-title">{middleTruncate(title)}</span>
                  <span className="conv-subtitle">
                    <span className="conv-subtitle-text">{sub}</span>
                  </span>
                </span>
              )}
              {definition && renamingId !== definition.id ? (
                <>
                  <button
                    type="button"
                    className={`conv-star-hit${favoriteSet.has(definition.id) ? ' favorited' : ''}`}
                    title={
                      favoriteSet.has(definition.id)
                        ? t('sidebar.menu.unfavorite')
                        : t('sidebar.menu.favorite')
                    }
                    aria-pressed={favoriteSet.has(definition.id)}
                    onClick={(event) => {
                      event.stopPropagation()
                      void setFavorite(definition.id, !favoriteSet.has(definition.id))
                    }}
                  >
                    <Star size={10} strokeWidth={1.75} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={`conv-pin-hit${definition.pinned ? ' pinned' : ''}`}
                    title={definition.pinned ? t('sidebar.menu.unpin') : t('sidebar.menu.pin')}
                    aria-pressed={!!definition.pinned}
                    onClick={(event) => {
                      event.stopPropagation()
                      void setPinned(definition.id, !definition.pinned)
                    }}
                  >
                    <Pin size={10} strokeWidth={1.75} aria-hidden />
                  </button>
                </>
              ) : null}
            </div>
            {live.map((row, index) =>
              renderSession(
                row,
                jobRuns.find((run) => run.conversationId === row.id),
                index === live.length - 1 && unmatched.length === 0 && archived.length === 0
                  ? 'last'
                  : 'mid'
              )
            )}
            {unmatched.map((run, index) => (
              <div
                key={run.id}
                className="conv-row is-swarm-item is-swarm-child"
                data-conversation-id={run.conversationId}
                onClick={() => void selectConversation(run.conversationId)}
              >
                <ConvBracket
                  kind={
                    index === unmatched.length - 1 && archived.length === 0 ? 'last' : 'mid'
                  }
                />
                <span className="conv-text">
                  <span className="conv-title">{runStatusLabel(run.status, t)}</span>
                  <span className="conv-subtitle">
                    <span className="conv-subtitle-text">
                      {relativeTime(run.startedAt)}
                      {run.error ? ` · ${run.error}` : ''}
                    </span>
                  </span>
                </span>
              </div>
            ))}
            {archived.length > 0 ? (
              <>
                <button
                  type="button"
                  className="conv-group-header interactive"
                  onClick={() => {
                    setArchivedOpen((prev) => {
                      const next = new Set(prev)
                      if (next.has(job.id)) next.delete(job.id)
                      else next.add(job.id)
                      return next
                    })
                  }}
                >
                  {showArchived ? (
                    <ChevronDown size={11} aria-hidden />
                  ) : (
                    <ChevronRight size={11} aria-hidden />
                  )}
                  {t('timer.archivedCount', { count: archived.length })}
                </button>
                {showArchived
                  ? archived.map((row, index) =>
                      renderSession(row, undefined, index === archived.length - 1 ? 'last' : 'mid')
                    )
                  : null}
              </>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
