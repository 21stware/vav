import { useEffect } from 'react'
import type { CliHostKind, QuotaWindow, QuotaWindowKind } from '@shared/types'
import type { HostAuthKind } from '@shared/cliAccountParse'
import { isStructuredCliHost } from '@shared/cliHost'
import type { MessageKey } from '@shared/i18n'
import { QUOTA_EXHAUSTED_PERCENT } from '@shared/cliErrors'
import { useT } from '../i18n/useT'
import { refreshUsage, useUsageCache } from '../lib/usageCache'
import { StaggerLine } from './ui'

/** After the agent-name stagger (48ms + a couple of word units). */
const QUOTA_STAGGER_BASE = 140
const QUOTA_STAGGER_STEP = 80
const UNIT_MS = 28

const KIND_SHORT: Partial<Record<QuotaWindowKind, MessageKey>> = {
  five_hour: 'token.quotaFiveHourShort',
  seven_day: 'token.quotaWeeklyShort',
  seven_day_opus: 'token.quotaWeeklyOpusShort',
  seven_day_sonnet: 'token.quotaWeeklySonnetShort',
  monthly: 'token.quotaMonthlyShort',
  cursor_api: 'token.quotaCursorApiShort',
  cursor_auto: 'token.quotaCursorAutoShort'
}

function remainShort(
  resetsAt: number | null,
  now: number,
  t: ReturnType<typeof useT>
): string | null {
  if (resetsAt == null) return null
  const ms = resetsAt - now
  if (ms <= 0) return null
  const mins = Math.max(1, Math.round(ms / 60_000))
  if (mins < 60) return t('token.quotaRemainMinutes', { n: mins })
  const hours = Math.round(mins / 60)
  if (hours < 36) return t('token.quotaRemainHours', { n: hours })
  return t('token.quotaRemainDays', { n: Math.round(hours / 24) })
}

function lineFor(
  window: QuotaWindow,
  showKind: boolean,
  now: number,
  t: ReturnType<typeof useT>
): string {
  const pct = Math.min(100, Math.max(0, window.usedPercent))
  const percent = pct.toFixed(pct >= 10 ? 0 : 1)
  const remain = remainShort(window.resetsAt, now, t)
  const kindKey = showKind ? KIND_SHORT[window.kind] : null
  const kind = kindKey ? t(kindKey) : null
  if (kind && remain) {
    return t('token.quotaEmptyLineKind', { kind, percent, remain })
  }
  if (kind) return t('token.quotaEmptyLineKindBare', { kind, percent })
  if (remain) return t('token.quotaEmptyLine', { percent, remain })
  return t('token.quotaEmptyLineBare', { percent })
}

function QuotaRow({
  window,
  showKind,
  now,
  baseDelay,
  updating
}: {
  window: QuotaWindow
  showKind: boolean
  now: number
  baseDelay: number
  updating: boolean
}): React.JSX.Element {
  const t = useT()
  const pct = Math.min(100, Math.max(0, window.usedPercent))
  const exhausted = pct >= QUOTA_EXHAUSTED_PERCENT
  const line = lineFor(window, showKind, now, t)
  const barDelay = baseDelay + line.split(/\s+/).filter(Boolean).length * UNIT_MS
  return (
    <div className={`empty-quota-row${exhausted ? ' is-exhausted' : ''}`}>
      <div className={`empty-quota-line${updating ? ' usage-shimmer' : ''}`}>
        <StaggerLine baseDelay={baseDelay}>{line}</StaggerLine>
      </div>
      <div className="empty-quota-bar-slot" style={{ animationDelay: `${barDelay}ms` }}>
        <div className="empty-quota-bar">
          <div className="empty-quota-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}

function PendingRow(): React.JSX.Element {
  return (
    <div className="empty-quota-row is-pending">
      <div className="empty-quota-line is-pending" />
      <div className="empty-quota-bar-slot">
        <div className="empty-quota-bar is-indeterminate">
          <div className="empty-quota-bar-fill" />
        </div>
      </div>
    </div>
  )
}

/**
 * Compact usage under the empty-session mark.
 * Cached quota paints immediately; a later refresh shimmers in place.
 */
const NOTICE_LINE: Record<Exclude<HostAuthKind, 'unknown'>, MessageKey> = {
  none: 'token.quotaSignedOut',
  expired: 'token.quotaExpired',
  'api-key': 'token.quotaApiKey',
  token: 'token.quotaToken',
  oauth: 'token.quotaSignedIn'
}

export function EmptyQuotaUsage({
  conversationId,
  host,
  accountId
}: {
  conversationId: string
  host: CliHostKind | null
  accountId?: string | null
}): React.JSX.Element | null {
  const t = useT()
  const canShow = isStructuredCliHost(host)
  const { snap, updating } = useUsageCache(host, accountId)

  useEffect(() => {
    if (!host || !canShow) return
    void refreshUsage({ conversationId, host, accountId })
  }, [conversationId, host, accountId, canShow])

  if (!host || !canShow) return null
  const pending = snap === null
  const rows = snap?.windows ?? []
  const noticeKind =
    snap && rows.length === 0 && snap.authKind !== 'unknown' ? snap.authKind : null
  const noticeText =
    noticeKind === 'oauth' && snap?.accountId
      ? snap.accountId
      : noticeKind
        ? t(NOTICE_LINE[noticeKind])
        : null
  const phase = pending ? 'pending' : rows.length > 0 ? 'ready' : noticeText ? 'notice' : 'empty'
  const now = Date.now()
  const showKind = rows.length > 1

  return (
    <div
      className={`empty-quota is-${phase}${updating && snap ? ' is-updating' : ''}`}
      aria-busy={pending || updating}
      aria-label={noticeText || t('token.quotaSection')}
    >
      <div className="empty-quota-reveal">
        <div className="empty-quota-reveal-inner">
          {pending ? (
            <PendingRow />
          ) : noticeText ? (
            <div className={`empty-quota-line${updating ? ' usage-shimmer' : ''}`}>
              <StaggerLine baseDelay={QUOTA_STAGGER_BASE}>{noticeText}</StaggerLine>
            </div>
          ) : (
            rows.map((window, index) => (
              <QuotaRow
                key={`${host}:${window.id}`}
                window={window}
                showKind={showKind}
                now={now}
                baseDelay={QUOTA_STAGGER_BASE + index * QUOTA_STAGGER_STEP}
                updating={updating}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
