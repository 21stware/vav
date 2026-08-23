import type { QuotaWindow, QuotaWindowKind } from '@shared/types'
import type { ProviderAccountViewPayload } from '@shared/ipc'
import type { HostAuthKind } from '@shared/cliAccountParse'
import { normalizeAuthKind } from '@shared/cliAccountParse'
import type { MessageKey, TParams } from '@shared/i18n'
import { QUOTA_EXHAUSTED_PERCENT } from '@shared/cliErrors'
import { isStructuredCliHost } from '@shared/cliHost'
import { hostMayHaveAccountQuota } from '@shared/quotaWindows'
import { formatExpiry } from '@shared/tokenUsage'
import { AgentBrandMark } from './AgentBrandMark'

const QUOTA_LABEL: Record<QuotaWindowKind, MessageKey> = {
  five_hour: 'token.quotaFiveHour',
  seven_day: 'token.quotaWeekly',
  seven_day_opus: 'token.quotaWeeklyOpus',
  seven_day_sonnet: 'token.quotaWeeklySonnet',
  monthly: 'token.quotaMonthly',
  cursor_api: 'token.quotaCursorApi',
  cursor_auto: 'token.quotaCursorAuto',
  primary: 'token.quotaPrimary',
  secondary: 'token.quotaSecondary',
  other: 'token.quotaOther'
}

type TFn = (key: MessageKey, params?: TParams) => string

function QuotaRow({
  window,
  now,
  locale,
  t
}: {
  window: QuotaWindow
  now: number
  locale: ProviderAccountViewPayload['locale']
  t: TFn
}): React.JSX.Element {
  const pct = Math.min(100, Math.max(0, window.usedPercent))
  const exhausted = pct >= QUOTA_EXHAUSTED_PERCENT
  const resets =
    window.resetsAt != null
      ? t('token.quotaResets', { clock: formatExpiry(window.resetsAt, now, locale) })
      : null
  return (
    <div className={`provider-account-quota${exhausted ? ' is-exhausted' : ''}`}>
      <div className="provider-account-quota-meta">
        <span>{t(QUOTA_LABEL[window.kind])}</span>
        <span className="provider-account-quota-pct">
          {t('token.quotaUsed', { percent: pct.toFixed(pct >= 10 ? 0 : 1) })}
        </span>
      </div>
      <div className="provider-account-bar">
        <div className="provider-account-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {resets ? <div className="provider-account-muted">{resets}</div> : null}
    </div>
  )
}

/**
 * Account + subscription body — pure props, no sessionStore.
 * Used by the native provider-account panel (hydrated from main).
 */
export function ProviderAccountPanel({
  payload,
  t
}: {
  payload: ProviderAccountViewPayload
  t: TFn
}): React.JSX.Element {
  const canPoll = hostMayHaveAccountQuota(payload.host)
  const knownHost = isStructuredCliHost(payload.host)
  const waiting = payload.loading && (canPoll || knownHost)
  const authKind: HostAuthKind = normalizeAuthKind(payload.authKind, payload.signedIn)
  const status = waiting
    ? payload.accountId || t('composer.accountLoading')
    : authKind === 'api-key'
      ? t('composer.accountApiKey')
      : authKind === 'token'
        ? t('composer.accountToken')
        : authKind === 'expired'
          ? t('composer.accountExpired')
          : authKind === 'oauth'
            ? payload.accountId || t('composer.accountSignedIn')
            : authKind === 'none'
              ? t('composer.accountSignedOut')
              : null
  const windows = payload.windows
  const notice =
    !waiting && windows.length === 0 && knownHost && authKind !== 'unknown' ? authKind : null
  const phase = waiting
    ? 'pending'
    : windows.length > 0
      ? 'ready'
      : notice
        ? 'notice'
        : 'empty'

  return (
    <div className="provider-account-panel" role="document" aria-label={t('composer.accountTitle')}>
      <div className="provider-account-head">
        <AgentBrandMark agent={{ id: payload.hostId, name: payload.hostName }} size={22} />
        <div className="provider-account-who">
          <div className="provider-account-name">{payload.hostName}</div>
          {status ? <div className="provider-account-status">{status}</div> : null}
          {payload.plan ? <div className="provider-account-muted">{payload.plan}</div> : null}
        </div>
      </div>
      <div className={`provider-account-quota-slot is-${phase}`} aria-busy={waiting}>
        <div className="provider-account-quota-reveal">
          <div className="provider-account-quota-reveal-inner">
            {waiting ? (
              <div className="provider-account-list is-pending">
                <QuotaSkeleton />
                <QuotaSkeleton />
              </div>
            ) : windows.length > 0 ? (
              <div className="provider-account-list">
                {windows.map((window) => (
                  <QuotaRow
                    key={window.id}
                    window={window}
                    now={payload.now}
                    locale={payload.locale}
                    t={t}
                  />
                ))}
              </div>
            ) : notice === 'none' ? (
              <div className="provider-account-signed-out">
                {t('composer.accountSignedOutHint')}
              </div>
            ) : notice === 'expired' ? (
              <div className="provider-account-signed-out">
                {t('composer.accountExpiredHint')}
              </div>
            ) : notice === 'api-key' ? (
              <div className="provider-account-signed-out">
                {t('composer.accountApiKeyHint')}
              </div>
            ) : notice === 'token' ? (
              <div className="provider-account-signed-out">
                {t('composer.accountTokenHint')}
              </div>
            ) : notice === 'oauth' ? (
              <div className="provider-account-signed-out">
                {t('composer.accountNoQuota')}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function QuotaSkeleton(): React.JSX.Element {
  return (
    <div className="provider-account-quota is-pending">
      <div className="provider-account-quota-meta">
        <span className="provider-account-skel" />
        <span className="provider-account-skel is-short" />
      </div>
      <div className="provider-account-bar is-indeterminate">
        <div className="provider-account-bar-fill" />
      </div>
    </div>
  )
}
