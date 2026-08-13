import { useMemo, useState } from 'react'
import type { AppLocale, QuotaWindow, QuotaWindowKind, TokenSnapshot } from '@shared/types'
import type { TokenUsageViewPayload } from '@shared/ipc'
import type { MessageKey, TParams } from '@shared/i18n'
import { PRESET_MODELS } from '@shared/types'
import { COMPACT_MIN_FOLDED, compactionForLeaf } from '@shared/compaction'
import {
  TOKEN_CHART_POINTS,
  cacheHitPercent,
  formatClock,
  formatExpiry,
  formatCost,
  modelDisplayName,
  providerLabel,
  sessionCostOf
} from '@shared/tokenUsage'

function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

type TFn = (key: MessageKey, params?: TParams) => string

function quotaLabel(kind: QuotaWindowKind, t: TFn): string {
  switch (kind) {
    case 'five_hour':
      return t('token.quotaFiveHour')
    case 'seven_day':
      return t('token.quotaWeekly')
    case 'seven_day_opus':
      return t('token.quotaWeeklyOpus')
    case 'seven_day_sonnet':
      return t('token.quotaWeeklySonnet')
    case 'monthly':
      return t('token.quotaMonthly')
    case 'primary':
      return t('token.quotaPrimary')
    case 'secondary':
      return t('token.quotaSecondary')
    default:
      return t('token.quotaOther')
  }
}

function QuotaWindowRow({
  window,
  now,
  locale,
  t
}: {
  window: QuotaWindow
  now: number
  locale: AppLocale
  t: TFn
}): React.JSX.Element {
  const pct = Math.min(100, Math.max(0, window.usedPercent))
  const resets =
    window.resetsAt != null
      ? t('token.quotaResets', { clock: formatExpiry(window.resetsAt, now, locale) })
      : null
  return (
    <div className="token-usage-quota-row">
      <div className="token-usage-quota-meta">
        <span className="token-usage-quota-name">{quotaLabel(window.kind, t)}</span>
        <span className="token-usage-quota-pct">
          {t('token.quotaUsed', { percent: pct.toFixed(pct >= 10 ? 0 : 1) })}
        </span>
      </div>
      <div className="token-usage-bar">
        <div className="token-usage-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {resets ? <div className="token-usage-muted">{resets}</div> : null}
    </div>
  )
}

/**
 * Context-window details body — pure props, no sessionStore.
 * Used by the native token-usage panel (hydrated from main).
 */
export function TokenUsagePanel({
  payload,
  t,
  locale,
  onPayloadPatch
}: {
  payload: TokenUsageViewPayload
  t: TFn
  locale: AppLocale
  /** Refresh fields after compact/clear without a full re-open. */
  onPayloadPatch?: (patch: Partial<TokenUsageViewPayload>) => void
}): React.JSX.Element {
  const { history, isRunning, model, tokenLimit } = payload
  const chartRows = useMemo(() => history.slice(-TOKEN_CHART_POINTS), [history])
  const latest = history.at(-1)
  // Prefer post-compact estimate / last-turn input over cumulative tokensUsed.
  const used = payload.contextTokens ?? latest?.totalInputTokens ?? payload.tokensUsed ?? 0
  const limit = tokenLimit ?? 200_000
  const pct = limit > 0 ? (used / limit) * 100 : 0
  // Prefer host-aware labels from main (CLI hosts are not VAV presets).
  const modelLabel =
    payload.modelLabel ||
    PRESET_MODELS.find((m) => m.id === model)?.label ||
    modelDisplayName(model)
  const providerName =
    payload.providerLabel || providerLabel(model, payload.apiEndpoint)
  const turnCostReported = latest?.costSource === 'provider'
  const turnCost = latest?.estimatedCost ?? 0
  const sessionCostReported = payload.reportedSessionCostUsd != null
  const sessionCost = sessionCostReported
    ? payload.reportedSessionCostUsd!
    : sessionCostOf(history)

  const hitPct = latest ? Math.round(cacheHitPercent(latest)) : 0
  const cacheHitLabel = latest
    ? isRunning
      ? `${formatCount(latest.cacheReadTokens)} / ${formatCount(latest.totalInputTokens)} tokens (${hitPct}%)`
      : `${formatCount(latest.cacheReadTokens)} tokens (${hitPct}%)`
    : '—'

  const pathCount = payload.pathMessageCount ?? 0
  // defaultKeepAfterIndex needs at least COMPACT_MIN_FOLDED folded + 1 kept.
  const enoughForCompact = !isRunning && pathCount >= COMPACT_MIN_FOLDED + 1
  const [compactBusy, setCompactBusy] = useState(false)
  const [compactNote, setCompactNote] = useState<string | null>(null)

  const runCompact = async (): Promise<void> => {
    if (payload.compactAvailable === false || !enoughForCompact || compactBusy) return
    setCompactBusy(true)
    setCompactNote(null)
    try {
      const result = await window.vav.agent.compact(payload.conversationId)
      if (!result.ok) {
        setCompactNote(result.error)
        return
      }
      // Quiet status in-panel — no toast. Transcript shows "history compact".
      setCompactNote(t('compact.logLine', { count: result.compaction.compactedCount }))
      onPayloadPatch?.({
        hasCompaction: true,
        compactedCount: result.compaction.compactedCount,
        contextTokens: result.compaction.estimatedContextTokens,
        contextTokensEstimated: true,
        tokensUsed: result.compaction.estimatedContextTokens
      })
    } finally {
      setCompactBusy(false)
    }
  }

  const runClear = async (): Promise<void> => {
    if (payload.compactAvailable === false || !payload.hasCompaction || compactBusy || isRunning) {
      return
    }
    setCompactBusy(true)
    setCompactNote(null)
    try {
      const full = await window.vav.conversations.get(payload.conversationId)
      if (!full) {
        setCompactNote(t('compact.error.missing'))
        return
      }
      const active = compactionForLeaf(
        full.compactions,
        full.messages,
        full.activeLeafId
      )
      if (!active) {
        setCompactNote(t('compact.error.missing'))
        return
      }
      const result = await window.vav.agent.clearCompaction(payload.conversationId, active.leafId)
      if (!result.ok) {
        setCompactNote(result.error)
        return
      }
      setCompactNote(t('compact.cleared'))
      const latestIn = full.tokenHistory?.at(-1)?.totalInputTokens ?? full.tokensUsed
      onPayloadPatch?.({
        hasCompaction: false,
        compactedCount: 0,
        contextTokens: latestIn,
        contextTokensEstimated: false,
        tokensUsed: latestIn
      })
    } finally {
      setCompactBusy(false)
    }
  }

  return (
    <div className="token-usage-panel" role="document" aria-label={t('token.contextWindow')}>
      <section className="token-usage-section">
        <div className="token-usage-heading">{t('token.consumption')}</div>
        <div className="token-usage-bar">
          <div className="token-usage-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <div className="token-usage-muted">
          {formatCount(used)} / {formatCount(limit)} tokens · {pct.toFixed(1)}%
          {payload.contextTokensEstimated ? ` · ${t('compact.estimateNote')}` : ''}
        </div>
        {!payload.hasProviderUsage && !payload.contextTokensEstimated && (
          <div className="token-usage-muted">{t('token.noProviderUsage')}</div>
        )}
      </section>

      {payload.cliHost && (payload.quotaWindows?.length ?? 0) > 0 ? (
        <section className="token-usage-section token-usage-quota">
          <div className="token-usage-heading">{t('token.quotaSection')}</div>
          <div className="token-usage-quota-list">
            {payload.quotaWindows!.map((window) => (
              <QuotaWindowRow
                key={window.id}
                window={window}
                now={payload.now}
                locale={locale}
                t={t}
              />
            ))}
          </div>
          <div className="token-usage-muted">{t('token.quotaLiveHint')}</div>
        </section>
      ) : null}

      {payload.compactAvailable !== false && (
        <section className="token-usage-section token-usage-compact">
          <div className="token-usage-heading">{t('compact.panelTitle')}</div>
          <div className="token-usage-muted">{t('compact.panelHint')}</div>
          <div className="token-usage-compact-actions">
            <button
              type="button"
              className="token-usage-btn"
              disabled={!enoughForCompact || compactBusy || payload.hasCompaction}
              onClick={() => void runCompact()}
            >
              {compactBusy ? t('common.loading') : t('compact.menuDefault')}
            </button>
            {payload.hasCompaction && (
              <button
                type="button"
                className="token-usage-btn secondary"
                disabled={compactBusy || isRunning}
                onClick={() => void runClear()}
              >
                {t('compact.restore')}
              </button>
            )}
          </div>
          {payload.hasCompaction && (
            <div className="token-usage-muted">
              {t('compact.banner', { count: payload.compactedCount })}
            </div>
          )}
          {compactNote && <div className="token-usage-compact-note">{compactNote}</div>}
        </section>
      )}

      <section className="token-usage-section">
        <div className="token-usage-heading">{t('token.cacheHitChart')}</div>
        {chartRows.length < 2 ? (
          <div className="token-usage-empty">
            <div className="token-usage-empty-title">{t('token.insufficientData')}</div>
            <div className="token-usage-muted">{t('token.needTwoTurns')}</div>
          </div>
        ) : (
          <>
            <CacheHitChart rows={chartRows} t={t} />
            <div className="token-usage-muted">{t('token.chartAxisHint')}</div>
          </>
        )}
      </section>

      <dl className="token-usage-kv">
        <div>
          <dt>{isRunning ? t('token.cacheHitThisTurn') : t('token.cacheHit')}</dt>
          <dd>{cacheHitLabel}</dd>
        </div>
        <div>
          <dt>{t('token.cacheWriteTime')}</dt>
          <dd>{formatClock(payload.cacheCreatedAt, locale)}</dd>
        </div>
        <div>
          <dt>{t('token.cacheExpireTime')}</dt>
          <dd>
            {formatExpiry(payload.cacheExpiresAt, payload.now, locale)}
            {payload.cacheExpiryEstimated ? (
              <div className="token-usage-muted">{t('token.cacheExpiryNote')}</div>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>{t('token.cacheReadTokens')}</dt>
          <dd>{latest ? formatCount(latest.cacheReadTokens) : '—'}</dd>
        </div>
        <div>
          <dt>{t('token.newWriteTokens')}</dt>
          <dd>{latest ? formatCount(latest.cacheWriteTokens) : '—'}</dd>
        </div>
      </dl>

      <dl className="token-usage-kv">
        <div>
          <dt>{turnCostReported ? t('token.turnCostReported') : t('token.turnCost')}</dt>
          <dd>
            {latest
              ? formatCost(turnCost, payload.displayCurrency ?? 'USD', !turnCostReported)
              : '—'}
          </dd>
        </div>
        <div>
          <dt>
            {sessionCostReported ? t('token.sessionCostReported') : t('token.sessionCost')}
          </dt>
          <dd>
            {payload.hasProviderUsage || sessionCostReported
              ? formatCost(sessionCost, payload.displayCurrency ?? 'USD', !sessionCostReported)
              : '—'}
          </dd>
        </div>
      </dl>

      <dl className="token-usage-kv">
        <div>
          <dt>{t('token.model')}</dt>
          <dd>{modelLabel || '—'}</dd>
        </div>
        <div>
          <dt>{t('token.provider')}</dt>
          <dd>{providerName || '—'}</dd>
        </div>
      </dl>
    </div>
  )
}

function CacheHitChart({ rows, t }: { rows: TokenSnapshot[]; t: TFn }): React.JSX.Element {
  const width = 300
  const height = 140
  const pad = { top: 12, right: 8, bottom: 22, left: 28 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const points = rows.map((row, index) => {
    const x = pad.left + (rows.length === 1 ? innerW / 2 : (index / (rows.length - 1)) * innerW)
    const y = pad.top + innerH - (Math.min(100, cacheHitPercent(row)) / 100) * innerH
    return {
      x,
      y,
      pct: cacheHitPercent(row),
      label: index === rows.length - 1 ? t('token.thisTurn') : `T-${rows.length - 1 - index}`
    }
  })

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')

  return (
    <svg className="token-usage-chart" viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
      {[0, 50, 100].map((tick) => {
        const y = pad.top + innerH - (tick / 100) * innerH
        return (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y}
              y2={y}
              className="token-usage-grid"
            />
            <text x={pad.left - 6} y={y + 3} className="token-usage-axis" textAnchor="end">
              {tick}
            </text>
          </g>
        )
      })}
      {points.slice(0, -1).map((p, i) => {
        const n = points[i + 1]!
        const healthy = (p.pct + n.pct) / 2 >= 50
        const base = height - pad.bottom
        return (
          <path
            key={i}
            className={healthy ? 'token-usage-area-good' : 'token-usage-area-low'}
            d={`M${p.x},${p.y} L${n.x},${n.y} L${n.x},${base} L${p.x},${base} Z`}
          />
        )
      })}
      <path d={line} className="token-usage-line" fill="none" />
      {points.map((p) => (
        <circle key={p.label + p.x} cx={p.x} cy={p.y} r={2.5} className="token-usage-dot" />
      ))}
      {points.map((p, i) =>
        i === 0 || i === points.length - 1 || i % 2 === 0 ? (
          <text key={`l-${p.label}`} x={p.x} y={height - 6} className="token-usage-axis" textAnchor="middle">
            {p.label}
          </text>
        ) : null
      )}
    </svg>
  )
}
