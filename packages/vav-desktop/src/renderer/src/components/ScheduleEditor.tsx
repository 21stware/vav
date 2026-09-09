import { useCallback, useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import type { TimerJob } from '@shared/timer'
import {
  clampEveryHours,
  clampHour,
  clampMinute,
  clampMonthDay,
  defaultOnceAt,
  defaultVisualSchedule,
  scheduleFromVisual,
  toggleWeekday,
  visualFromSchedule,
  visualWeekdays,
  type VisualSchedule
} from '@shared/cronUi'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { useSidebarFloatMode } from '../lib/sidebarLayout'
import { relativeTime } from '../lib/format'
import { ShellLeadingControls } from './ShellLeadingControls'
import { Composer } from './Composer'
import { Button, Toggle } from './ui'

function onceInputValue(at: number): string {
  const date = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function visualWithMode(current: VisualSchedule, mode: VisualSchedule['mode']): VisualSchedule {
  if (mode === 'once') {
    return { mode: 'once', at: current.mode === 'once' ? current.at : defaultOnceAt() }
  }
  const hour = current.mode === 'daily' || current.mode === 'weekly' || current.mode === 'monthly' ? current.hour : 9
  const minute =
    current.mode === 'daily' || current.mode === 'weekly' || current.mode === 'monthly' ? current.minute : 0
  if (mode === 'hourly') {
    return { mode: 'hourly', everyHours: current.mode === 'hourly' ? current.everyHours : 1 }
  }
  if (mode === 'weekly') {
    return {
      mode: 'weekly',
      hour,
      minute,
      weekdays: current.mode === 'weekly' ? current.weekdays : [1, 2, 3, 4, 5]
    }
  }
  if (mode === 'monthly') {
    return { mode: 'monthly', hour, minute, day: current.mode === 'monthly' ? current.day : 1 }
  }
  return { mode: 'daily', hour, minute }
}

export function ScheduleEditor({
  conversationId
}: {
  conversationId: string | null
}): React.JSX.Element {
  const t = useT()
  const conversation = useSessionStore((s) =>
    conversationId ? s.conversations.find((row) => row.id === conversationId) : undefined
  )
  const ensureScheduledConversation = useSessionStore((s) => s.ensureScheduledConversation)
  const showToast = useSessionStore((s) => s.showToast)
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const sidebarFloating = useSidebarFloatMode()
  const showShellLeading = !(sidebarVisible && !sidebarFloating)
  const [job, setJob] = useState<TimerJob | null>(null)
  const [prompt, setPrompt] = useState('')
  const [visual, setVisual] = useState<VisualSchedule>(defaultVisualSchedule)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!conversationId) ensureScheduledConversation()
  }, [conversationId, ensureScheduledConversation])

  const loadJob = useCallback(async (): Promise<TimerJob | null> => {
    if (!conversationId || !window.vav?.timers?.getJobForConversation) {
      setJob(null)
      return null
    }
    const next = await window.vav.timers.getJobForConversation(conversationId)
    setJob(next)
    if (!next) return null
    const active = document.activeElement
    const promptFocused =
      active instanceof HTMLTextAreaElement && active.dataset.testid === 'timer-prompt'
    const scheduleFocused =
      (active instanceof HTMLInputElement || active instanceof HTMLSelectElement) &&
      (active.dataset.testid === 'timer-mode' ||
        active.dataset.testid === 'timer-hourly' ||
        active.dataset.testid === 'timer-time' ||
        active.dataset.testid === 'timer-once' ||
        active.dataset.testid === 'timer-month-day')
    if (!promptFocused) setPrompt(next.prompt)
    if (!scheduleFocused) setVisual(visualFromSchedule(next.schedule))
    return next
  }, [conversationId])

  useEffect(() => {
    void loadJob()
    return window.vav.timers?.onChanged(() => {
      void loadJob()
    })
  }, [loadJob])

  useEffect(() => {
    const field = document.querySelector<HTMLTextAreaElement>('[data-testid="timer-prompt"]')
    field?.focus()
  }, [])

  const persist = async (patch: {
    prompt?: string
    visual?: VisualSchedule
    enabled?: boolean
  }): Promise<TimerJob | null> => {
    const current = job
    if (!current) return null
    const nextPrompt = (patch.prompt ?? prompt).trim()
    const enabled = patch.enabled ?? current.enabled
    if (enabled && !nextPrompt) {
      showToast({ kind: 'error', title: t('timer.promptRequired') })
      return current
    }
    const schedule = scheduleFromVisual(patch.visual ?? visual)
    try {
      const updated = await window.vav.timers.updateJob(current.id, {
        title: conversation?.title?.trim() || current.title || t('timer.untitled'),
        prompt: nextPrompt,
        schedule,
        enabled,
        sourceWorkdir: conversation?.workingDirectory
      })
      if (updated) setJob(updated)
      return updated
    } catch (err) {
      showToast({
        kind: 'error',
        title: t('timer.createFailed'),
        description: err instanceof Error ? err.message : String(err)
      })
      return null
    }
  }

  const setMode = (mode: VisualSchedule['mode']): void => {
    const next = visualWithMode(visual, mode)
    setVisual(next)
    void persist({ visual: next })
  }

  const runNow = async (): Promise<void> => {
    if (!job) return
    if (!prompt.trim() && !job.prompt.trim()) {
      showToast({ kind: 'error', title: t('timer.promptRequired') })
      return
    }
    setBusy(true)
    try {
      await persist({ prompt })
      const result = await window.vav.timers.runNow(job.id)
      if (result?.conversationId) {
        await useSessionStore.getState().selectConversation(result.conversationId)
        return
      }
      showToast({ kind: 'info', title: t('timer.runBusy') })
    } finally {
      setBusy(false)
    }
  }

  const modes: { mode: VisualSchedule['mode']; label: string }[] = [
    { mode: 'once', label: t('timer.repeatOnce') },
    { mode: 'hourly', label: t('timer.repeatHourly') },
    { mode: 'daily', label: t('timer.repeatDaily') },
    { mode: 'weekly', label: t('timer.repeatWeekly') },
    { mode: 'monthly', label: t('timer.repeatMonthly') }
  ]

  return (
    <main className="detail" data-testid="schedule-editor">
      <header
        className={`terminal-host-chrome agent-mode-chrome${showShellLeading ? ' has-shell-leading' : ''}`}
      >
        <div className="agent-mode-chrome-row">
          {showShellLeading ? (
            <div className="agent-mode-shell-leading">
              <ShellLeadingControls />
            </div>
          ) : null}
          <span className="spacer" />
          <Toggle
            checked={job?.enabled ?? false}
            title={t('timer.enabled')}
            testId="timer-enabled"
            onChange={(enabled) => void persist({ enabled, prompt })}
          />
          <span className="schedule-editor-enable-label">{t('timer.enabled')}</span>
          <Button
            icon={<Play size={13} />}
            label={t('timer.runNow')}
            size="sm"
            variant="secondary"
            disabled={busy || !job}
            testId="timer-run-now"
            onClick={() => void runNow()}
          />
        </div>
      </header>

      <div className="schedule-editor-body">
        <div className="schedule-editor-group">
          <section className="schedule-editor-when">
            <div className="schedule-editor-when-row">
              <label className="schedule-editor-field">
                <span>{t('timer.scheduleTitle')}</span>
                <select
                  className="text-field"
                  data-testid="timer-mode"
                  aria-label={t('timer.scheduleTitle')}
                  value={visual.mode}
                  onChange={(event) => setMode(event.currentTarget.value as VisualSchedule['mode'])}
                >
                  {modes.map((item) => (
                    <option key={item.mode} value={item.mode} data-testid={`timer-mode-${item.mode}`}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              {visual.mode === 'once' ? (
                <input
                  className="text-field"
                  data-testid="timer-once"
                  type="datetime-local"
                  value={onceInputValue(visual.at)}
                  onChange={(event) => {
                    const at = Date.parse(event.currentTarget.value)
                    if (!Number.isFinite(at)) return
                    const next: VisualSchedule = { mode: 'once', at }
                    setVisual(next)
                    void persist({ visual: next })
                  }}
                />
              ) : null}

              {visual.mode === 'hourly' ? (
                <label className="schedule-editor-field">
                  <span>{t('timer.everyHours')}</span>
                  <input
                    className="text-field"
                    data-testid="timer-hourly"
                    type="number"
                    min={1}
                    max={12}
                    value={visual.everyHours}
                    onChange={(event) => {
                      const next: VisualSchedule = {
                        mode: 'hourly',
                        everyHours: clampEveryHours(Number(event.currentTarget.value) || 1)
                      }
                      setVisual(next)
                      void persist({ visual: next })
                    }}
                  />
                </label>
              ) : null}

              {visual.mode === 'daily' || visual.mode === 'weekly' || visual.mode === 'monthly' ? (
                <label className="schedule-editor-field">
                  <span>{t('timer.atTime')}</span>
                  <input
                    className="text-field"
                    data-testid="timer-time"
                    type="time"
                    value={`${String(visual.hour).padStart(2, '0')}:${String(visual.minute).padStart(2, '0')}`}
                    onChange={(event) => {
                      const [hourRaw, minuteRaw] = event.currentTarget.value.split(':')
                      const hour = clampHour(Number(hourRaw))
                      const minute = clampMinute(Number(minuteRaw))
                      const next: VisualSchedule =
                        visual.mode === 'weekly'
                          ? { ...visual, hour, minute }
                          : visual.mode === 'monthly'
                            ? { ...visual, hour, minute }
                            : { mode: 'daily', hour, minute }
                      setVisual(next)
                      void persist({ visual: next })
                    }}
                  />
                </label>
              ) : null}

              {visual.mode === 'monthly' ? (
                <label className="schedule-editor-field">
                  <span>{t('timer.monthDay')}</span>
                  <input
                    className="text-field"
                    data-testid="timer-month-day"
                    type="number"
                    min={1}
                    max={31}
                    value={visual.day}
                    onChange={(event) => {
                      const next: VisualSchedule = {
                        ...visual,
                        day: clampMonthDay(Number(event.currentTarget.value) || 1)
                      }
                      setVisual(next)
                      void persist({ visual: next })
                    }}
                  />
                </label>
              ) : null}
            </div>

            {visual.mode === 'weekly' ? (
              <div className="schedule-editor-weekdays" role="group" aria-label={t('timer.repeatWeekly')}>
                {visualWeekdays().map((day) => {
                  const on = visual.weekdays.includes(day)
                  return (
                    <button
                      key={day}
                      type="button"
                      className={`chip${on ? ' active' : ''}`}
                      aria-pressed={on}
                      data-testid={`timer-weekday-${day}`}
                      onClick={() => {
                        const next: VisualSchedule = {
                          ...visual,
                          weekdays: toggleWeekday(visual.weekdays, day)
                        }
                        setVisual(next)
                        void persist({ visual: next })
                      }}
                    >
                      {t(`timer.weekday.${day}` as 'timer.weekday.0')}
                    </button>
                  )
                })}
              </div>
            ) : null}

            {job?.nextRunAt ? (
              <div className="schedule-editor-next">
                {t('timer.nextRun', { when: relativeTime(job.nextRunAt) })}
              </div>
            ) : null}
          </section>

          <Composer
            conversationId={conversationId}
            variant="schedule"
            value={prompt}
            onChange={setPrompt}
            onCommit={(next) => void persist({ prompt: next })}
          />
        </div>
      </div>
    </main>
  )
}
