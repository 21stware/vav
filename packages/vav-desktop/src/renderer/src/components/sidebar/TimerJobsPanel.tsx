import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Pin, Plus, Star, Trash2 } from 'lucide-react'
import type { ConversationMeta } from '@shared/types'
import type { TimerJob, TimerRun } from '@shared/timer'
import { useSessionStore } from '../../state/sessionStore'
import { upsertConversationMeta } from '../../state/sessionListMerge'
import { timerListConversationIds, timerScheduleLabel, timerSessionsForJob } from '../../lib/timerSessions'
import { flattenSessionTitle, adjacentRunClass } from '../../lib/sidebarList'
import { relativeTime, middleTruncate } from '../../lib/format'
import { showMenu, type MenuItem } from '../../lib/nativeMenu'
import { lucideMenuIcon } from '../../lib/menuIcons'
import { useT } from '../../i18n/useT'
import { RenameField } from './RenameField'
import { Button } from '../ui'

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
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [archivedOpen, setArchivedOpen] = useState<Set<string>>(() => new Set())
  const weekday = (day: number): string => t(`timer.weekday.${day}` as 'timer.weekday.0')

  const hydrateSessions = useCallback(async (): Promise<void> => {
    if (!window.vav?.timers?.listSessions) return
    const sessions = await window.vav.timers.listSessions()
    useSessionStore.setState((state) => {
      let next = state.conversations
      for (const session of sessions) next = upsertConversationMeta(next, session)
      return { conversations: next }
    })
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (!window.vav?.timers) return
    setLoading(true)
    try {
      const [nextJobs, nextRuns] = await Promise.all([
        window.vav.timers.listJobs(),
        window.vav.timers.listRuns()
      ])
      setJobs(nextJobs)
      setRuns(nextRuns)
      await hydrateSessions()
    } catch {
      setJobs([])
      setRuns([])
    } finally {
      setLoading(false)
    }
  }, [hydrateSessions])

  useEffect(() => {
    void refresh()
    return window.vav.timers?.onChanged(() => {
      void refresh()
    })
  }, [refresh])

  const orderedIds = useMemo(
    () => timerListConversationIds(jobs, conversations),
    [jobs, conversations]
  )

  const openJob = async (job: TimerJob): Promise<void> => {
    if (job.conversationId) {
      await selectConversation(job.conversationId)
      return
    }
    showToast({ kind: 'info', title: t('timer.openFailed') })
  }

  const removeJob = async (job: TimerJob): Promise<void> => {
    setBusyId(job.id)
    try {
      await window.vav.timers.removeJob(job.id)
      await refresh()
    } finally {
      setBusyId(null)
    }
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

  const renderSession = (conversation: ConversationMeta, run?: TimerRun): React.JSX.Element => {
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
      <div className="timer-jobs-toolbar">
        <Button
          icon={<Plus size={14} />}
          label={t('timer.new')}
          size="sm"
          variant="secondary"
          testId="timer-new"
          onClick={() => void createScheduledConversation()}
        />
      </div>

      {jobs.map((job) => {
        const { live, archived } = timerSessionsForJob(conversations, job.id)
        const jobRuns = runs.filter((run) => run.jobId === job.id)
        const unmatched = jobRuns.filter(
          (run) => !conversations.some((row) => row.id === run.conversationId)
        )
        const busy = busyId === job.id
        const jobActive = job.conversationId === activeId
        const showArchived = archivedOpen.has(job.id)
        return (
          <div
            key={job.id}
            className={`timer-job${jobActive ? ' is-active' : ''}`}
            data-testid={`timer-job-${job.id}`}
          >
            <div className="timer-job-head">
              <button
                type="button"
                className="timer-job-copy"
                data-conversation-id={job.conversationId ?? undefined}
                onClick={() => void openJob(job)}
              >
                <div className="timer-job-title">{job.title}</div>
                <div className="timer-job-sub">
                  {timerScheduleLabel(job.schedule, weekday)}
                  {job.enabled ? ` · ${t('timer.enabled')}` : ''}
                  {job.nextRunAt ? ` · ${relativeTime(job.nextRunAt)}` : ''}
                </div>
              </button>
              <Button
                icon={<Trash2 size={13} />}
                size="sm"
                title={t('common.delete')}
                disabled={busy}
                onClick={() => void removeJob(job)}
              />
            </div>
            {live.length === 0 && unmatched.length === 0 && archived.length === 0 ? (
              <div className="timer-job-empty">{t('timer.noRuns')}</div>
            ) : (
              <div className="timer-job-sessions">
                {live.map((row) =>
                  renderSession(
                    row,
                    jobRuns.find((run) => run.conversationId === row.id)
                  )
                )}
                {unmatched.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    className="file-session-item"
                    data-conversation-id={run.conversationId}
                    onClick={() => void selectConversation(run.conversationId)}
                  >
                    <span className="file-session-item-title">{runStatusLabel(run.status, t)}</span>
                    <span className="file-session-item-sub">
                      {relativeTime(run.startedAt)}
                      {run.error ? ` · ${run.error}` : ''}
                    </span>
                  </button>
                ))}
                {archived.length > 0 ? (
                  <>
                    <button
                      type="button"
                      className="timer-job-archived-toggle"
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
                    {showArchived ? archived.map((row) => renderSession(row)) : null}
                  </>
                ) : null}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
