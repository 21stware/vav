import { useCallback, useEffect, useState } from 'react'
import { Calendar, ChevronDown, Clock, Play } from 'lucide-react'
import type { TimerJob } from '@shared/timer'
import { recentsForMachine, normalizeMachineId } from '@shared/workspaceHost'
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
import { isDraftScheduledTitle } from '../lib/draftEditorTitle'
import { isTemporaryWorkspace, relativeTime } from '../lib/format'
import { basename } from '../lib/path'
import { ShellLeadingControls } from './ShellLeadingControls'
import { Composer } from './Composer'
import { Button, Toggle } from './ui'

const WORKSPACE_MINT = 'mint'
const WORKSPACE_STICKY = 'sticky'
const WORKSPACE_PICK = '__pick__'

function workspaceSelectValue(job: TimerJob | null, tmp: string): string {
  if (!job) return WORKSPACE_MINT
  if (job.workdirPolicy === 'mint') return WORKSPACE_MINT
  if (job.workdirPolicy === 'sticky') return WORKSPACE_STICKY
  if (job.sourceWorkdir && !isTemporaryWorkspace(job.sourceWorkdir, tmp)) {
    return `dir:${job.sourceWorkdir}`
  }
  if (job.workdirPolicy === 'source' && job.sourceWorkdir) return WORKSPACE_STICKY
  return WORKSPACE_MINT
}

function folderOptionLabel(path: string, all: string[]): string {
  const name = basename(path)
  return all.filter((entry) => basename(entry) === name).length > 1 ? path : name
}

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
  const renameConversation = useSessionStore((s) => s.renameConversation)
  const showToast = useSessionStore((s) => s.showToast)
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const tmp = useSessionStore((s) => s.tmp)
  const recentDirs = useSessionStore((s) => s.settings.recentWorkspaceDirectories)
  const windowMachineId = useSessionStore((s) => s.windowMachineId)
  const setWorkingDirectory = useSessionStore((s) => s.setWorkingDirectory)
  const pickWorkingDirectory = useSessionStore((s) => s.pickWorkingDirectory)
  const sidebarFloating = useSidebarFloatMode()
  const showShellLeading = !(sidebarVisible && !sidebarFloating)
  const [job, setJob] = useState<TimerJob | null>(null)
  const [title, setTitle] = useState('')
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
    const titleFocused =
      active instanceof HTMLInputElement && active.dataset.testid === 'timer-title'
    const promptFocused =
      active instanceof HTMLTextAreaElement && active.dataset.testid === 'timer-prompt'
    const scheduleFocused =
      (active instanceof HTMLInputElement || active instanceof HTMLSelectElement) &&
      (active.dataset.testid === 'timer-mode' ||
        active.dataset.testid === 'timer-hourly' ||
        active.dataset.testid === 'timer-time' ||
        active.dataset.testid === 'timer-once' ||
        active.dataset.testid === 'timer-month-day' ||
        active.dataset.testid === 'timer-workspace')
    if (!titleFocused) setTitle(next.title)
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
    workdirPolicy?: TimerJob['workdirPolicy']
    sourceWorkdir?: string | null
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
        title: title.trim() || conversation?.title?.trim() || current.title || t('timer.untitled'),
        prompt: nextPrompt,
        schedule,
        enabled,
        ...(patch.workdirPolicy !== undefined ? { workdirPolicy: patch.workdirPolicy } : {}),
        ...(patch.sourceWorkdir !== undefined ? { sourceWorkdir: patch.sourceWorkdir } : {})
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

  const applySourceFolder = async (path: string): Promise<void> => {
    if (conversationId) await setWorkingDirectory(conversationId, path)
    await persist({ workdirPolicy: 'source', sourceWorkdir: path })
  }

  const pickWorkspace = async (): Promise<void> => {
    if (!conversationId) return
    const before = useSessionStore
      .getState()
      .conversations.find((row) => row.id === conversationId)?.workingDirectory
    await pickWorkingDirectory(conversationId)
    const next = useSessionStore
      .getState()
      .conversations.find((row) => row.id === conversationId)?.workingDirectory
    if (next && next !== before) await persist({ workdirPolicy: 'source', sourceWorkdir: next })
  }

  const setWorkspace = (value: string): void => {
    if (value === WORKSPACE_PICK) {
      void pickWorkspace()
      return
    }
    if (value === WORKSPACE_MINT) {
      void persist({ workdirPolicy: 'mint', sourceWorkdir: null })
      return
    }
    if (value === WORKSPACE_STICKY) {
      void persist({ workdirPolicy: 'sticky', sourceWorkdir: null })
      return
    }
    if (value.startsWith('dir:')) void applySourceFolder(value.slice(4))
  }

  const setMode = (mode: VisualSchedule['mode']): void => {
    const next = visualWithMode(visual, mode)
    setVisual(next)
    void persist({ visual: next })
  }

  const commitTitle = async (): Promise<void> => {
    const next = title.trim() || t('timer.untitled')
    if (next !== title) setTitle(next)
    if (conversationId && next !== conversation?.title) {
      await renameConversation(conversationId, next)
    }
  }

  const create = async (): Promise<void> => {
    if (!job) return
    if (!prompt.trim() && !job.prompt.trim()) {
      showToast({ kind: 'error', title: t('timer.promptRequired') })
      return
    }
    setBusy(true)
    try {
      await commitTitle()
      await persist({ prompt, enabled: true })
    } finally {
      setBusy(false)
    }
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

  const machineId = normalizeMachineId(conversation?.machineId ?? windowMachineId)
  const recents = recentsForMachine(recentDirs, machineId)
  const workspaceValue = workspaceSelectValue(job, tmp)
  const selectedPath = workspaceValue.startsWith('dir:') ? workspaceValue.slice(4) : null
  const folderPaths = [
    ...(selectedPath && !recents.some((ref) => ref.path === selectedPath) ? [selectedPath] : []),
    ...recents.map((ref) => ref.path)
  ]

  const modeSelect = (
    <div className="font-select">
      <select
        className="text-field font-select-field"
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
      <ChevronDown className="font-select-chevron" size={14} strokeWidth={2} aria-hidden />
    </div>
  )

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
        </div>
      </header>

      <div className="schedule-editor-body">
        <div className="schedule-editor-card">
          <div className="schedule-editor-intro">
            <input
              className={`text-field schedule-editor-title${
                isDraftScheduledTitle(title, t('timer.untitled')) ? ' is-untitled' : ''
              }`}
              data-testid="timer-title"
              value={title}
              placeholder={t('timer.titlePlaceholder')}
              autoComplete="off"
              spellCheck={false}
              aria-label={t('timer.titlePlaceholder')}
              onChange={(event) => setTitle(event.currentTarget.value)}
              onFocus={(event) => {
                if (isDraftScheduledTitle(event.currentTarget.value, t('timer.untitled'))) {
                  event.currentTarget.select()
                }
              }}
              onBlur={() => void commitTitle()}
            />
          </div>

          <div className="settings-form">
            {visual.mode === 'once' ? (
              <label className="settings-field">
                <span>{t('timer.scheduleTitle')}</span>
                {modeSelect}
              </label>
            ) : (
              <div className="schedule-editor-row">
                <label className="settings-field">
                  <span>{t('timer.scheduleTitle')}</span>
                  {modeSelect}
                </label>

                {visual.mode === 'hourly' ? (
                  <label className="settings-field">
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
                  <label className="settings-field">
                    <span>{t('timer.atTime')}</span>
                    <span className="schedule-editor-picker">
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
                      <span className="schedule-editor-picker-icon" aria-hidden>
                        <Clock size={13} />
                      </span>
                    </span>
                  </label>
                ) : null}
              </div>
            )}

            {visual.mode === 'once' ? (
              <label className="settings-field">
                <span>{t('timer.atTime')}</span>
                <span className="schedule-editor-picker">
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
                  <span className="schedule-editor-picker-icon" aria-hidden>
                    <Calendar size={13} />
                  </span>
                </span>
              </label>
            ) : null}

            {visual.mode === 'monthly' ? (
              <label className="settings-field">
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

            {visual.mode === 'weekly' ? (
              <div className="settings-field">
                <span>{t('timer.repeatWeekly')}</span>
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
              </div>
            ) : null}

            <label className="settings-field">
              <span>{t('timer.workspace')}</span>
              <div className="font-select">
                <select
                  className="text-field font-select-field"
                  data-testid="timer-workspace"
                  aria-label={t('timer.workspace')}
                  value={workspaceValue}
                  onChange={(event) => setWorkspace(event.currentTarget.value)}
                >
                  <option value={WORKSPACE_MINT}>{t('timer.workspaceMint')}</option>
                  <option value={WORKSPACE_STICKY}>{t('timer.workspaceSticky')}</option>
                  <option value={WORKSPACE_PICK}>{t('tools.pickOtherDir')}</option>
                  {folderPaths.length > 0 ? (
                    <optgroup label={t('tools.recentDirs')}>
                      {folderPaths.map((path) => (
                        <option key={path} value={`dir:${path}`}>
                          {folderOptionLabel(path, folderPaths)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
                <ChevronDown className="font-select-chevron" size={14} strokeWidth={2} aria-hidden />
              </div>
            </label>
          </div>

          <Composer
            conversationId={conversationId}
            variant="schedule"
            value={prompt}
            onChange={setPrompt}
            onCommit={(next) => void persist({ prompt: next })}
          />

          <label className="settings-field row">
            <span>{t('timer.enabled')}</span>
            <Toggle
              checked={job?.enabled ?? false}
              title={t('timer.enabled')}
              testId="timer-enabled"
              onChange={(enabled) => void persist({ enabled, prompt })}
            />
          </label>

          <div className="schedule-editor-actions">
            <Button
              label={t('timer.create')}
              variant="primary"
              disabled={busy || !job}
              testId="timer-create"
              onClick={() => void create()}
            />
            <Button
              icon={<Play size={13} />}
              label={t('timer.runNow')}
              variant="secondary"
              disabled={busy || !job}
              testId="timer-run-now"
              onClick={() => void runNow()}
            />
          </div>

          {job?.nextRunAt ? (
            <p className="schedule-editor-next">
              {t('timer.nextRun', { when: relativeTime(job.nextRunAt) })}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  )
}
