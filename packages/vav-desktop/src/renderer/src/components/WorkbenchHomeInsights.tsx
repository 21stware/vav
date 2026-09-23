import { useEffect, useMemo } from 'react'
import type { MessageKey } from '@shared/i18n'
import type { QuotaWindowKind } from '@shared/types'
import { formatApiBalanceAmount } from '@shared/apiBalance'
import { analysisSinceMs, filterAnalysisTurns } from '@shared/analysis'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { useAccountGroups } from '../lib/accountGroups'
import { refreshAnalysis, useAnalysisCache } from '../lib/analysisCache'
import { formatTokens } from '../lib/format'
import {
  primaryQuotaWindow,
  weekTokensFromConversations,
  weekTurnTokens,
  weekUsageSpark,
  workbenchLibraryCounts
} from '../lib/workbenchHomeStats'
import { AgentBrandMark } from './AgentBrandMark'

const QUOTA_KIND_KEY: Partial<Record<QuotaWindowKind, MessageKey>> = {
  five_hour: 'token.quotaFiveHourShort',
  seven_day: 'token.quotaWeeklyShort',
  seven_day_opus: 'token.quotaWeeklyOpusShort',
  seven_day_sonnet: 'token.quotaWeeklySonnetShort',
  monthly: 'token.quotaMonthlyShort',
  cursor_api: 'token.quotaCursorApiShort',
  cursor_auto: 'token.quotaCursorAutoShort'
}

function accountLabel(account: {
  alias: string | null
  identityName: string
  name: string
}): string {
  return account.alias?.trim() || account.identityName.trim() || account.name.trim()
}

function WeekSpark({ values }: { values: number[] }): React.JSX.Element | null {
  const peak = Math.max(...values, 0)
  if (peak <= 0) return null
  return (
    <span className="workbench-home-spark" aria-hidden>
      {values.map((value, index) => (
        <span
          key={index}
          className="workbench-home-spark-bar"
          style={{ height: `${Math.max(12, Math.round((value / peak) * 100))}%` }}
        />
      ))}
    </span>
  )
}

function StatTile({
  label,
  value,
  meta,
  bar,
  spark,
  exhausted,
  testId,
  onClick
}: {
  label: string
  value: string
  meta?: string
  bar?: number | null
  spark?: number[]
  exhausted?: boolean
  testId: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="workbench-home-stat"
      data-testid={testId}
      data-exhausted={exhausted ? 'true' : undefined}
      onClick={onClick}
    >
      <span className="workbench-home-stat-label">{label}</span>
      <span className="workbench-home-stat-value">{value}</span>
      {meta ? <span className="workbench-home-stat-meta">{meta}</span> : null}
      {spark ? <WeekSpark values={spark} /> : null}
      {typeof bar === 'number' ? (
        <span className="workbench-home-stat-bar" aria-hidden>
          <span className="workbench-home-stat-bar-fill" style={{ width: `${bar}%` }} />
        </span>
      ) : null}
    </button>
  )
}

export function WorkbenchHomeInsights(): React.JSX.Element {
  const t = useT()
  const conversations = useSessionStore((s) => s.conversations)
  const openSettings = useSessionStore((s) => s.openSettings)
  const setApplicationsMode = useSessionStore((s) => s.setApplicationsMode)
  const groups = useAccountGroups()
  const { snapshot } = useAnalysisCache()

  useEffect(() => {
    void refreshAnalysis({ force: false })
  }, [])

  const account = useMemo(() => {
    const all = groups.flatMap((group) => group.accounts)
    const current = all.find((row) => row.current)
    if (current?.quotaWindows.length) return current
    return all.find((row) => row.quotaWindows.length > 0) ?? current ?? all[0] ?? null
  }, [groups])

  const quota = account ? primaryQuotaWindow(account.quotaWindows) : null
  const quotaPct = quota ? Math.min(100, Math.max(0, Math.round(quota.usedPercent))) : null
  const counts = useMemo(() => workbenchLibraryCounts(conversations), [conversations])
  const now = snapshot?.now ?? Date.now()
  const weekTurns = useMemo(
    () => filterAnalysisTurns(snapshot?.usage.turns ?? [], analysisSinceMs('7d', now)),
    [snapshot?.usage.turns, now]
  )
  const fromAnalysis = snapshot?.usage != null
  const weekTokens = fromAnalysis
    ? weekTurnTokens(weekTurns)
    : weekTokensFromConversations(conversations, now)
  const spark = fromAnalysis ? weekUsageSpark(weekTurns, now) : []

  const balanceText =
    account?.balance && account.balance.available
      ? formatApiBalanceAmount({
          source: account.balance.source === 'openrouter' ? 'openrouter' : 'deepseek',
          currency: account.balance.currency,
          total: account.balance.amount,
          granted: 0,
          toppedUp: 0,
          available: true
        })
      : null
  const planValue = quota ? `${quotaPct}%` : (balanceText ?? '—')
  const planMeta = quota
    ? t(QUOTA_KIND_KEY[quota.kind] ?? 'token.quotaWeeklyShort')
    : balanceText
      ? t('workbench.home.statBalance')
      : t('workbench.home.statPlanEmpty')
  const user = account ? accountLabel(account) : ''

  return (
    <header className="workbench-home-hero" data-testid="workbench-home-insights">
      <div className="workbench-home-mark" aria-hidden>
        <AgentBrandMark agent={{ id: 'vav', name: 'VAV' }} size={52} />
      </div>
      <h1 className="workbench-home-title">VAV</h1>
      {user ? <p className="workbench-home-user">{user}</p> : null}
      <div className="workbench-home-stats">
        <StatTile
          label={t('workbench.home.statPlan')}
          value={planValue}
          meta={planMeta}
          bar={quotaPct}
          exhausted={quotaPct != null && quotaPct >= 90}
          testId="home-stat-plan"
          onClick={() => openSettings('analysis')}
        />
        <StatTile
          label={t('workbench.home.statWeek')}
          value={formatTokens(weekTokens)}
          meta={t('workbench.home.statWeekUnit')}
          spark={spark.some((value) => value > 0) ? spark : undefined}
          testId="home-stat-week"
          onClick={() => openSettings('analysis')}
        />
        <StatTile
          label={t('workbench.home.statNotes')}
          value={String(counts.notes)}
          testId="home-stat-notes"
          onClick={() => setApplicationsMode('knowledge')}
        />
        <StatTile
          label={t('workbench.home.statStorage')}
          value={String(counts.storage)}
          testId="home-stat-storage"
          onClick={() => setApplicationsMode('storage')}
        />
      </div>
    </header>
  )
}
