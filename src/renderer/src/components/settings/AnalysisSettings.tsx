import { useEffect, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import type { AnalysisHostUsage, AnalysisProvider, AnalysisUsageTotals } from '@shared/analysis'
import { localAnalysisProviders, orderByProviderList, stubAnalysisProviders } from '@shared/analysis'
import { isLlmVendorId, vendorById, groupAccountsByVendor } from '@shared/llmVendors'
import { apiBalanceProviderLabel, formatApiBalanceAmount } from '@shared/apiBalance'
import type { AppLocale, DisplayCurrency, QuotaWindow, QuotaWindowKind } from '@shared/types'
import { DEFAULT_CLI_AGENTS } from '@shared/types'
import { displayNameForCliHost, isStructuredCliHost } from '@shared/cliHost'
import { normalizeAuthKind } from '@shared/cliAccountParse'
import { QUOTA_EXHAUSTED_PERCENT } from '@shared/cliErrors'
import { formatCost, formatExpiry } from '@shared/tokenUsage'
import type { MessageKey } from '@shared/i18n'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { useAccountGroups, vavAccountsOf } from '../../lib/accountGroups'
import {
  getAgentInstallStatus,
  refreshAgentInstallStatus,
  useAgentInstallMap
} from '../../lib/agentInstallStatus'
import { refreshAnalysis, useAnalysisCache } from '../../lib/analysisCache'
import { AgentBrandMark } from '../AgentBrandMark'
import { Button } from '../ui'

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

function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

function hostLabel(hostKey: string, fallback?: string): string {
  if (fallback) return fallback
  if (isLlmVendorId(hostKey)) return vendorById(hostKey)?.name ?? hostKey
  if (hostKey === 'vav') return 'VAV'
  return isStructuredCliHost(hostKey) ? displayNameForCliHost(hostKey) : hostKey
}

function usageTokens(row: AnalysisUsageTotals): number {
  return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens
}

export function AnalysisSettings(): React.JSX.Element {
  const t = useT()
  const locale = useSessionStore((s) => s.resolvedLocale)
  const settings = useSessionStore((s) => s.settings)
  const currency = settings.displayCurrency
  const installById = useAgentInstallMap()
  const accountGroups = useAccountGroups()
  const vendors = useMemo(
    () =>
      groupAccountsByVendor(vavAccountsOf(accountGroups)).map((row) => ({
        id: row.vendor.id,
        name: row.vendor.name
      })),
    [accountGroups]
  )
  const localProviders = useMemo(() => {
    const present = new Set<string>()
    for (const agent of DEFAULT_CLI_AGENTS) {
      if ((installById[agent.id] ?? getAgentInstallStatus(agent.id)) === 'ready') {
        present.add(agent.id)
      }
    }
    for (const agent of settings.cliAgents ?? []) {
      if ((installById[agent.id] ?? getAgentInstallStatus(agent.id)) === 'ready') {
        present.add(agent.id)
      }
    }
    return stubAnalysisProviders(
      localAnalysisProviders(settings.cliAgents, DEFAULT_CLI_AGENTS, present, {
        vendors,
        order: settings.providerListOrder
      }),
      settings.apiKeyPresent,
      {
        keyPresentByHost: Object.fromEntries(
          groupAccountsByVendor(vavAccountsOf(accountGroups)).map((row) => [
            row.vendor.id,
            row.accounts.some((account) => account.keyPresent)
          ])
        )
      }
    )
  }, [
    accountGroups,
    installById,
    settings.apiKeyPresent,
    settings.cliAgents,
    settings.providerListOrder,
    vendors
  ])
  const { snapshot, error, refreshing, syncing, updating } = useAnalysisCache()

  useEffect(() => {
    void refreshAgentInstallStatus({ force: false, discover: false })
    void refreshAnalysis({ force: false })
  }, [])

  const usage = snapshot?.usage
  const listOrder = settings.providerListOrder ?? []
  const providers = orderByProviderList(
    snapshot?.providers?.length ? snapshot.providers : localProviders,
    (provider) => provider.hostKey,
    listOrder
  )
  const hosts = orderByProviderList(
    usage?.hosts ?? [],
    (host) => host.hostKey,
    listOrder,
    (a, b) => b.costUsd - a.costUsd || b.turns - a.turns
  )
  const now = snapshot?.now ?? Date.now()
  const usagePending = !usage && syncing
  const names = new Map(providers.map((p) => [p.hostKey, p.hostName]))

  return (
    <div className="analysis-stack" data-testid="settings-analysis">
      <section className="analysis-section">
        <div className="analysis-section-head">
          <p className="analysis-lede">{t('analysis.usageHint')}</p>
        </div>
        {usage && usage.total.sessions > 0 ? (
          <>
            <div
              className={`analysis-summary${updating ? ' is-updating' : ''}`}
              aria-busy={updating}
            >
              <UsageStat
                label={t('analysis.total')}
                totals={usage.total}
                currency={currency}
                updating={updating}
                t={t}
              />
            </div>
            <div className={`analysis-host-list${updating ? ' is-updating' : ''}`}>
              {hosts.map((host) => (
                <HostUsageRow
                  key={host.hostKey}
                  host={host}
                  name={hostLabel(host.hostKey, names.get(host.hostKey))}
                  currency={currency}
                  updating={updating}
                  t={t}
                />
              ))}
            </div>
          </>
        ) : usagePending ? (
          <p className="analysis-lede">{t('common.loading')}</p>
        ) : (
          <p className="analysis-lede">{t('analysis.usageEmpty')}</p>
        )}
      </section>

      <section className="analysis-section">
        <div className="analysis-section-head">
          <div className="analysis-card-head">
            <h2 className="analysis-title">{t('analysis.subscriptionTitle')}</h2>
            <Button
              icon={<RefreshCw size={14} className={refreshing ? 'analysis-spin' : undefined} />}
              label={refreshing ? t('analysis.refreshing') : t('analysis.refresh')}
              variant="secondary"
              size="sm"
              disabled={refreshing}
              onClick={() => void refreshAnalysis({ force: true })}
            />
          </div>
          <p className="analysis-lede">{t('analysis.subscriptionHint')}</p>
          {error ? <p className="analysis-lede analysis-error">{t('analysis.loadFailed')}</p> : null}
        </div>
        {providers.length === 0 ? (
          <p className="analysis-lede">{t('analysis.subscriptionEmpty')}</p>
        ) : (
          <div className={`analysis-provider-list${updating ? ' is-updating' : ''}`}>
            {providers.map((provider) => (
              <ProviderSubscription
                key={provider.hostKey}
                provider={provider}
                now={now}
                locale={locale}
                querying={updating && !provider.windows.length && !provider.balance}
                updating={updating}
                t={t}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function UsageStat({
  label,
  totals,
  currency,
  updating = false,
  t
}: {
  label: string
  totals: AnalysisUsageTotals
  currency: DisplayCurrency
  updating?: boolean
  t: ReturnType<typeof useT>
}): React.JSX.Element {
  return (
    <div className="analysis-stat">
      <div className="analysis-stat-label">{label}</div>
      <div className={`analysis-stat-value${updating ? ' usage-shimmer' : ''}`}>
        {formatCost(totals.costUsd, currency, totals.costApprox)}
      </div>
      <div className="analysis-stat-meta">
        {t('analysis.usageMeta', {
          sessions: formatCount(totals.sessions),
          tokens: formatCount(usageTokens(totals))
        })}
      </div>
    </div>
  )
}

function HostUsageRow({
  host,
  name,
  currency,
  updating = false,
  t
}: {
  host: AnalysisHostUsage
  name: string
  currency: DisplayCurrency
  updating?: boolean
  t: ReturnType<typeof useT>
}): React.JSX.Element {
  return (
    <div className="analysis-row">
      <AgentBrandMark agent={{ id: host.hostKey, name }} size={20} />
      <div className="analysis-row-who">
        <div className="analysis-row-name">{name}</div>
        <div className="analysis-row-meta">
          {t('analysis.hostMeta', {
            sessions: formatCount(host.sessions),
            turns: formatCount(host.turns)
          })}
        </div>
      </div>
      <div className="analysis-row-nums">
        <div className={`analysis-row-cost${updating ? ' usage-shimmer' : ''}`}>
          {formatCost(host.costUsd, currency, host.costApprox)}
        </div>
        <div className="analysis-row-meta">
          {t('analysis.tokensUnit', { n: formatCount(usageTokens(host)) })}
        </div>
      </div>
    </div>
  )
}

function ProviderSubscription({
  provider,
  now,
  locale,
  querying,
  updating = false,
  t
}: {
  provider: AnalysisProvider
  now: number
  locale: AppLocale
  querying: boolean
  updating?: boolean
  t: ReturnType<typeof useT>
}): React.JSX.Element {
  const authKind = normalizeAuthKind(provider.authKind, provider.signedIn)
  const status =
    provider.kind === 'api'
      ? authKind === 'api-key'
        ? t('token.quotaApiKey')
        : t('analysis.apiKeyEmpty')
      : authKind === 'api-key'
        ? t('token.quotaApiKey')
        : authKind === 'token'
          ? t('token.quotaToken')
          : authKind === 'expired'
            ? t('token.quotaExpired')
            : authKind === 'oauth'
              ? provider.accountId || t('token.quotaSignedIn')
              : authKind === 'none'
                ? t('token.quotaSignedOut')
                : null
  const windows = provider.windows
  const balance = provider.balance
  const balanceLine =
    provider.kind === 'api' && balance
      ? t(balance.available || balance.total > 0 ? 'analysis.apiBalance' : 'analysis.apiBalanceUnavailable', {
          provider: apiBalanceProviderLabel(balance.source),
          amount: formatApiBalanceAmount(balance)
        })
      : provider.kind === 'api' && querying && provider.balanceState !== 'none' && provider.balanceState !== 'unsupported'
        ? t('analysis.apiBalanceLoading')
        : provider.kind === 'api' && provider.balanceState === 'error'
          ? t('analysis.apiBalanceFailed')
          : null

  const notice =
    windows.length > 0
      ? null
      : balanceLine
        ? balanceLine
        : provider.kind === 'api'
        ? t('analysis.apiNoQuota')
        : authKind === 'none'
          ? t('composer.accountSignedOutHint')
          : authKind === 'expired'
            ? t('composer.accountExpiredHint')
            : authKind === 'api-key'
              ? t('composer.accountApiKeyHint')
              : authKind === 'token'
                ? t('composer.accountTokenHint')
                : authKind === 'oauth'
                  ? t('composer.accountNoQuota')
                  : null

  const who = windows.length > 0 ? [status, provider.plan].filter(Boolean).join(' · ') : notice

  return (
    <div className="analysis-provider">
      <AgentBrandMark agent={{ id: provider.hostKey, name: provider.hostName }} size={20} />
      <div className="analysis-provider-body">
        <div className="analysis-row-who">
          <div className="analysis-row-name">{provider.hostName}</div>
          {who ? (
            <div className={`analysis-row-meta${updating && windows.length === 0 ? ' usage-shimmer' : ''}`}>
              {who}
            </div>
          ) : null}
        </div>
        {windows.length > 0 ? (
          <div className="analysis-quota-list">
            {windows.map((window) => (
              <QuotaRow
                key={window.id}
                window={window}
                now={now}
                locale={locale}
                updating={updating}
                t={t}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function QuotaRow({
  window,
  now,
  locale,
  updating = false,
  t
}: {
  window: QuotaWindow
  now: number
  locale: AppLocale
  updating?: boolean
  t: ReturnType<typeof useT>
}): React.JSX.Element {
  const pct = Math.min(100, Math.max(0, window.usedPercent))
  const exhausted = pct >= QUOTA_EXHAUSTED_PERCENT
  const resets =
    window.resetsAt != null
      ? t('token.quotaResets', { clock: formatExpiry(window.resetsAt, now, locale) })
      : null
  return (
    <div className={`analysis-quota${exhausted ? ' is-exhausted' : ''}`}>
      <div className="analysis-quota-meta">
        <span>{t(QUOTA_LABEL[window.kind])}</span>
        <span className={`analysis-quota-pct${updating ? ' usage-shimmer' : ''}`}>
          {t('token.quotaUsed', { percent: pct.toFixed(pct >= 10 ? 0 : 1) })}
        </span>
      </div>
      <div className="analysis-bar">
        <div className="analysis-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {resets ? <div className="analysis-row-meta">{resets}</div> : null}
    </div>
  )
}
