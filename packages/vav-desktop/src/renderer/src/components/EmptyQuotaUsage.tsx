import { useEffect, useState } from 'react'
import type { CliHostKind, QuotaWindow, QuotaWindowKind } from '@shared/types'
import type { HostAuthKind } from '@shared/cliAccountParse'
import { normalizeAuthKind } from '@shared/cliAccountParse'
import { isStructuredCliHost } from '@shared/cliHost'
import type { MessageKey } from '@shared/i18n'
import { QUOTA_EXHAUSTED_PERCENT } from '@shared/cliErrors'
import type { AccountView } from '@shared/ipc'
import { accountShowsOAuthQuota } from '@shared/accounts'
import { formatApiBalanceAmount } from '@shared/apiBalance'
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

const NOTICE_LINE: Record<Exclude<HostAuthKind, 'unknown'>, MessageKey> = {
  none: 'token.quotaSignedOut',
  expired: 'token.quotaExpired',
  'api-key': 'token.quotaApiKey',
  token: 'token.quotaToken',
  oauth: 'token.quotaSignedIn'
}

export function quotaNoticeForAccount(
  account: AccountView,
  t: ReturnType<typeof useT>
): string | null {
  if (account.kind === 'vav_key') {
    if (!account.balance) return null
    return account.balance.available
      ? formatApiBalanceAmount({
          source: account.balance.source === 'openrouter' ? 'openrouter' : 'deepseek',
          currency: account.balance.currency,
          total: account.balance.amount,
          granted: 0,
          toppedUp: 0,
          available: account.balance.available
        })
      : t('accounts.balanceUnavailable')
  }
  const authKind = normalizeAuthKind(
    account.oauthExpired ? 'expired' : account.oauthSignedIn ? 'oauth' : 'none',
    account.oauthSignedIn
  )
  if (account.quotaWindows.length > 0) return null
  if (authKind === 'unknown') return null
  if (authKind === 'oauth') return account.identityName || account.name
  return t(NOTICE_LINE[authKind])
}

/**
 * Compact usage bars — empty-session mark and provider-account lists share this.
 */
export function QuotaUsageView({
  windows,
  pending,
  updating = false,
  noticeText = null,
  hostKey = 'quota',
  align = 'center'
}: {
  windows: QuotaWindow[]
  pending: boolean
  updating?: boolean
  noticeText?: string | null
  hostKey?: string
  align?: 'center' | 'start'
}): React.JSX.Element {
  const t = useT()
  const now = Date.now()
  const showKind = windows.length > 1
  const phase = pending ? 'pending' : windows.length > 0 ? 'ready' : noticeText ? 'notice' : 'empty'
  return (
    <div
      className={`empty-quota is-${phase}${updating && !pending ? ' is-updating' : ''}${
        align === 'start' ? ' is-start' : ''
      }`}
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
            windows.map((window, index) => (
              <QuotaRow
                key={`${hostKey}:${window.id}`}
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

/**
 * Compact usage under the empty-session mark.
 * Switching host / account always plays loading, then the bars — same as first visit.
 */
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
  const identity = `${host ?? ''}:${accountId ?? ''}`
  const { snap, updating } = useUsageCache(host, accountId)
  const [readyFor, setReadyFor] = useState<string | null>(null)

  useEffect(() => {
    if (!host || !canShow) return
    let cancelled = false
    setReadyFor(null)
    void refreshUsage({ conversationId, host, accountId, force: true }).finally(() => {
      if (!cancelled) setReadyFor(identity)
    })
    return () => {
      cancelled = true
    }
  }, [conversationId, host, accountId, canShow, identity])

  if (!host || !canShow) return null
  const pending = readyFor !== identity
  const rows = pending ? [] : (snap?.windows ?? [])
  const noticeKind =
    !pending && snap && rows.length === 0 && snap.authKind !== 'unknown' ? snap.authKind : null
  const noticeText =
    noticeKind === 'oauth' && snap?.accountId
      ? snap.accountId
      : noticeKind
        ? t(NOTICE_LINE[noticeKind])
        : null

  return (
    <QuotaUsageView
      windows={rows}
      pending={pending}
      updating={!pending && updating}
      noticeText={noticeText}
      hostKey={host}
    />
  )
}

export function accountQuotaPending(account: AccountView, extraPending: boolean): boolean {
  if (extraPending) return true
  if (!accountShowsOAuthQuota(account) && account.kind !== 'vav_key') return extraPending
  return account.quotaStatus === 'loading' && account.quotaWindows.length === 0
}
