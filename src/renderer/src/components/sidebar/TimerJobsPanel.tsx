import { useCallback, useEffect, useState } from 'react'
import { Plus, Play, Trash2 } from 'lucide-react'
import type { TimerJob, TimerJobInput, TimerRun, TimerSchedule } from '@shared/timer'
import { formatTimerSchedule } from '@shared/timer'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { relativeTime } from '../../lib/format'
import { Button, EmptyState, Toggle } from '../ui'

function defaultOnceAt(): string {
  const at = new Date(Date.now() + 60 * 60 * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

function runStatusLabel(status: TimerRun['status'], t: ReturnType<typeof useT>): string {
  if (status === 'running') return t('timer.runRunning')
  if (status === 'done') return t('timer.runDone')
  if (status === 'failed') return t('timer.runFailed')
  return t('timer.runSkipped')
}

export function TimerJobsPanel(): React.JSX.Element {
  const t = useT()
  const selectConversation = useSessionStore((s) => s.selectConversation)
  const showToast = useSessionStore((s) => s.showToast)
  const [jobs, setJobs] = useState<TimerJob[]>([])
  const [runs, setRuns] = useState<TimerRun[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<TimerSchedule['kind']>('interval')
  const [intervalMinutes, setIntervalMinutes] = useState('60')
  const [cronExpr, setCronExpr] = useState('0 9 * * 1-5')
  const [onceAt, setOnceAt] = useState(defaultOnceAt)
  const [busyId, setBusyId] = useState<string | null>(null)

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
    } catch {
      setJobs([])
      setRuns([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    return window.vav.timers?.onChanged(() => {
      void refresh()
    })
  }, [refresh])

  const buildSchedule = (): TimerSchedule | null => {
    if (kind === 'cron') return { kind: 'cron', expr: cronExpr.trim() }
    if (kind === 'once') {
      const at = Date.parse(onceAt)
      if (!Number.isFinite(at)) return null
      return { kind: 'once', at }
    }
    const minutes = Number(intervalMinutes)
    if (!Number.isFinite(minutes) || minutes < 1) return null
    return { kind: 'interval', everyMs: Math.max(60_000, Math.floor(minutes * 60_000)) }
  }

  const createJob = async (): Promise<void> => {
    const schedule = buildSchedule()
    const nextTitle = title.trim()
    const nextPrompt = prompt.trim()
    if (!schedule || !nextTitle || !nextPrompt) {
      showToast({ kind: 'error', title: t('timer.formInvalid') })
      return
    }
    const input: TimerJobInput = { title: nextTitle, prompt: nextPrompt, schedule, enabled: true }
    try {
      await window.vav.timers.createJob(input)
      setTitle('')
      setPrompt('')
      setCreating(false)
      await refresh()
    } catch (err) {
      showToast({
        kind: 'error',
        title: t('timer.createFailed'),
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  const toggleEnabled = async (job: TimerJob, enabled: boolean): Promise<void> => {
    setBusyId(job.id)
    try {
      await window.vav.timers.updateJob(job.id, { enabled })
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const runNow = async (job: TimerJob): Promise<void> => {
    setBusyId(job.id)
    try {
      const result = await window.vav.timers.runNow(job.id)
      await refresh()
      if (result?.conversationId) {
        await selectConversation(result.conversationId)
        return
      }
      showToast({ kind: 'info', title: t('timer.runBusy') })
    } finally {
      setBusyId(null)
    }
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

  const openRun = async (run: TimerRun): Promise<void> => {
    await selectConversation(run.conversationId)
  }

  if (!loading && jobs.length === 0 && !creating) {
    return (
      <EmptyState title={t('sidebar.timersEmptyTitle')} description={t('sidebar.timersEmptyDesc')}>
        <button className="btn secondary" type="button" onClick={() => setCreating(true)}>
          {t('timer.new')}
        </button>
      </EmptyState>
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
          onClick={() => setCreating((value) => !value)}
        />
      </div>

      {creating ? (
        <div className="timer-job-form" data-testid="timer-job-form">
          <input
            className="text-field"
            data-testid="timer-title"
            placeholder={t('timer.titlePlaceholder')}
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
          <textarea
            className="text-field"
            data-testid="timer-prompt"
            rows={4}
            placeholder={t('timer.promptPlaceholder')}
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
          />
          <div className="timer-job-form-row">
            <select
              className="text-field"
              data-testid="timer-kind"
              value={kind}
              onChange={(event) => setKind(event.currentTarget.value as TimerSchedule['kind'])}
            >
              <option value="interval">{t('timer.kindInterval')}</option>
              <option value="cron">{t('timer.kindCron')}</option>
              <option value="once">{t('timer.kindOnce')}</option>
            </select>
            {kind === 'interval' ? (
              <input
                className="text-field"
                data-testid="timer-interval"
                type="number"
                min={1}
                value={intervalMinutes}
                onChange={(event) => setIntervalMinutes(event.currentTarget.value)}
                placeholder={t('timer.intervalMinutes')}
              />
            ) : null}
            {kind === 'cron' ? (
              <input
                className="text-field"
                data-testid="timer-cron"
                value={cronExpr}
                onChange={(event) => setCronExpr(event.currentTarget.value)}
                placeholder={t('timer.cronPlaceholder')}
              />
            ) : null}
            {kind === 'once' ? (
              <input
                className="text-field"
                data-testid="timer-once"
                type="datetime-local"
                value={onceAt}
                onChange={(event) => setOnceAt(event.currentTarget.value)}
              />
            ) : null}
          </div>
          <div className="timer-job-form-row">
            <Button
              label={t('timer.create')}
              variant="secondary"
              size="sm"
              testId="timer-create"
              onClick={() => void createJob()}
            />
            <Button label={t('common.cancel')} size="sm" onClick={() => setCreating(false)} />
          </div>
        </div>
      ) : null}

      {jobs.map((job) => {
        const jobRuns = runs.filter((run) => run.jobId === job.id).slice(0, 8)
        const busy = busyId === job.id
        return (
          <div key={job.id} className="timer-job" data-testid={`timer-job-${job.id}`}>
            <div className="timer-job-head">
              <div className="timer-job-copy">
                <div className="timer-job-title">{job.title}</div>
                <div className="timer-job-sub">
                  {formatTimerSchedule(job.schedule)}
                  {job.nextRunAt ? ` · ${relativeTime(job.nextRunAt)}` : ''}
                  {job.lastStatus ? ` · ${job.lastStatus}` : ''}
                </div>
              </div>
              <Toggle
                checked={job.enabled}
                title={t('timer.enabled')}
                onChange={(enabled) => void toggleEnabled(job, enabled)}
              />
              <Button
                icon={<Play size={13} />}
                size="sm"
                title={t('timer.runNow')}
                disabled={busy}
                onClick={() => void runNow(job)}
              />
              <Button
                icon={<Trash2 size={13} />}
                size="sm"
                title={t('common.delete')}
                disabled={busy}
                onClick={() => void removeJob(job)}
              />
            </div>
            {jobRuns.length === 0 ? (
              <div className="timer-job-empty">{t('timer.noRuns')}</div>
            ) : (
              <div className="timer-run-list">
                {jobRuns.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    className="file-session-item"
                    data-conversation-id={run.conversationId}
                    onClick={() => void openRun(run)}
                  >
                    <span className="file-session-item-title">
                      {runStatusLabel(run.status, t)}
                    </span>
                    <span className="file-session-item-sub">
                      {relativeTime(run.startedAt)}
                      {run.error ? ` · ${run.error}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
