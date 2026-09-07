import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { LOG_EVENT, LOG_RETENTION_DAYS, type AppLogRecord, type LogChannel, type LogRetentionDays } from '@shared/appLog'
import type { AppLogStats } from '@shared/appLog'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button, Segmented } from '../ui'

type ChannelFilter = 'all' | LogChannel

function formatTime(ts: number, locale: string): string {
  return new Date(ts).toLocaleTimeString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function LogsSettings(): React.JSX.Element {
  const t = useT()
  const locale = useSessionStore((s) => s.resolvedLocale)
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const showDialog = useSessionStore((s) => s.showDialog)
  const [channel, setChannel] = useState<ChannelFilter>('all')
  const [search, setSearch] = useState('')
  const [records, setRecords] = useState<AppLogRecord[]>([])
  const [stats, setStats] = useState<AppLogStats>({ ephemeral: 0, session: 0, durable: 0, total: 0 })

  const reload = useCallback(async () => {
    const [next, nextStats] = await Promise.all([
      window.vav.logs.query({ channel, search, limit: 250 }),
      window.vav.logs.stats()
    ])
    setRecords(next)
    setStats(nextStats)
  }, [channel, search])

  useEffect(() => {
    void reload()
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.vav.logs.onChanged(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void reload()
      }, 120)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [reload])

  const retention = (settings.logRetentionDays ?? 7) as LogRetentionDays
  const empty = records.length === 0
  const statsLine = useMemo(
    () =>
      t('logs.stats', {
        ephemeral: stats.ephemeral,
        session: stats.session,
        durable: stats.durable
      }),
    [stats, t]
  )

  return (
    <div className="form logs-settings">
      <div className="form-hint">{t('logs.hint')}</div>

      <div className="form-row">
        <label htmlFor="settings-log-retention">{t('logs.retention')}</label>
        <div className="control">
          <div className="font-select">
            <select
              id="settings-log-retention"
              className="text-field font-select-field"
              data-testid="settings-log-retention"
              value={retention}
              onChange={(event) => {
                const next = Number(event.target.value) as LogRetentionDays
                void updateSettings({ logRetentionDays: next })
              }}
            >
              {LOG_RETENTION_DAYS.map((days) => (
                <option key={days} value={days}>
                  {t(`logs.retention.${days}` as 'logs.retention.1')}
                </option>
              ))}
            </select>
            <ChevronDown className="font-select-chevron" size={14} strokeWidth={2} aria-hidden />
          </div>
        </div>
      </div>
      <div className="form-hint">{t('logs.retention.hint')}</div>

      <div className="logs-toolbar">
        <Segmented<ChannelFilter>
          options={[
            { value: 'all', label: t('logs.channel.all') },
            { value: 'user', label: t('logs.channel.user') },
            { value: 'agent', label: t('logs.channel.agent') },
            { value: 'system', label: t('logs.channel.system') }
          ]}
          value={channel}
          onChange={setChannel}
        />
        <input
          className="text-field logs-search"
          data-testid="settings-log-search"
          value={search}
          placeholder={t('logs.search')}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="logs-stats" data-testid="settings-log-stats">
        {statsLine}
      </div>

      <div className="logs-list" data-testid="settings-log-list">
        {empty ? (
          <div className="logs-empty" data-testid="settings-log-empty">
            {t('logs.empty')}
          </div>
        ) : (
          records.map((row) => (
            <div
              key={row.id}
              className="logs-row"
              data-channel={row.channel}
              data-level={row.level}
              data-retention={row.retention}
            >
              <span className="logs-time">{formatTime(row.ts, locale)}</span>
              <span className="logs-ch">{t(`logs.channel.${row.channel}` as 'logs.channel.user')}</span>
              <span className="logs-event">{row.event}</span>
              <span className="logs-msg">{row.message}</span>
              <span className="logs-class">
                {t(`logs.retentionClass.${row.retention}` as 'logs.retentionClass.ephemeral')}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="about-actions">
        <Button
          label={t('logs.clearEphemeral')}
          variant="secondary"
          testId="settings-log-clear-temp"
          onClick={() => {
            void window.vav.logs.clear('ephemeral').then(() => reload())
          }}
        />
        <Button
          label={t('logs.export')}
          variant="secondary"
          testId="settings-log-export"
          onClick={() => {
            void window.vav.logs.export({ channel, search })
          }}
        />
        <Button
          label={t('logs.clearAll')}
          variant="danger"
          testId="settings-log-clear-all"
          onClick={() =>
            showDialog({
              title: t('logs.clearAllTitle'),
              body: t('logs.clearAllBody'),
              confirmLabel: t('common.clear'),
              destructive: true,
              onConfirm: () => {
                void window.vav.logs.clear('all').then(() => reload())
              }
            })
          }
        />
      </div>
    </div>
  )
}

export function recordSettingsNav(view: string): void {
  void window.vav.logs.record({
    channel: 'user',
    event: LOG_EVENT.userSettingsNav,
    message: view
  })
}
