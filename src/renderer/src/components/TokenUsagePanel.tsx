import { useEffect, useMemo } from 'react'
import type { TokenSnapshot } from '@shared/types'
import { PRESET_MODELS } from '@shared/types'
import {
  TOKEN_CHART_POINTS,
  cacheHitPercent,
  formatClock,
  formatExpiry,
  formatUsd,
  modelDisplayName,
  providerLabel,
  sessionCostOf
} from '@shared/tokenUsage'
import { useSessionStore } from '../state/sessionStore'
import { useLocale, useT } from '../i18n/useT'

/** Stable empty — `?? []` in a zustand selector re-renders forever. */
const NO_HISTORY: TokenSnapshot[] = []

function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

/**
 * Context-window details body — used by the native token-usage window.
 */
export function TokenUsagePanel({ conversationId }: { conversationId: string }): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const conversation = useSessionStore((s) => s.conversations.find((c) => c.id === conversationId))
  const history = useSessionStore((s) => s.tokenHistories[conversationId] ?? NO_HISTORY)
  const cacheCreatedAt = useSessionStore((s) => s.cacheCreatedAt[conversationId] ?? null)
  const cacheExpiresAt = useSessionStore((s) => s.cacheExpiresAt[conversationId] ?? null)
  const isRunning = useSessionStore((s) => !!s.turns[conversationId]?.isRunning)
  const endpoint = useSessionStore((s) => s.settings.apiEndpoint)
  const refreshTokenUsage = useSessionStore((s) => s.refreshTokenUsage)

  useEffect(() => {
    void refreshTokenUsage(conversationId)
  }, [conversationId, refreshTokenUsage])

  useEffect(() => {
    if (!isRunning) return
    const timer = window.setInterval(() => void refreshTokenUsage(conversationId), 2000)
    return () => window.clearInterval(timer)
  }, [isRunning, conversationId, refreshTokenUsage])

  const latest = history.at(-1)
  const chartRows = useMemo(() => history.slice(-TOKEN_CHART_POINTS), [history])
  const used = conversation?.tokensUsed ?? 0
  const limit = conversation?.tokenLimit ?? 200_000
  const pct = limit > 0 ? (used / limit) * 100 : 0
  const modelId = conversation?.model ?? ''
  const modelLabel =
    PRESET_MODELS.find((m) => m.id === modelId)?.label ?? modelDisplayName(modelId)
  const sessionCost = sessionCostOf(history)
  const turnCost = latest?.estimatedCost ?? 0

  const hitPct = latest ? Math.round(cacheHitPercent(latest)) : 0
  const cacheHitLabel = latest
    ? isRunning
      ? `${formatCount(latest.cacheReadTokens)} / ${formatCount(latest.totalInputTokens)} tokens (${hitPct}%)`
      : `${formatCount(latest.cacheReadTokens)} tokens (${hitPct}%)`
    : '—'

  return (
    <div className="token-usage-panel" role="document" aria-label={t('token.contextWindow')}>
      <section className="token-usage-section">
        <div className="token-usage-heading">{t('token.consumption')}</div>
        <div className="token-usage-bar">
          <div className="token-usage-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <div className="token-usage-muted">
          {formatCount(used)} / {formatCount(limit)} tokens · {pct.toFixed(1)}%
        </div>
      </section>

      <section className="token-usage-section">
        <div className="token-usage-heading">{t('token.cacheHitChart')}</div>
        {chartRows.length < 2 ? (
          <div className="token-usage-empty">
            <div className="token-usage-empty-title">{t('token.insufficientData')}</div>
            <div className="token-usage-muted">{t('token.needTwoTurns')}</div>
          </div>
        ) : (
          <>
            <CacheHitChart rows={chartRows} />
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
          <dd>{formatClock(cacheCreatedAt, locale)}</dd>
        </div>
        <div>
          <dt>{t('token.cacheExpireTime')}</dt>
          <dd>{formatExpiry(cacheExpiresAt, Date.now(), locale)}</dd>
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
          <dt>{t('token.turnCost')}</dt>
          <dd>{formatUsd(turnCost)}</dd>
        </div>
        <div>
          <dt>{t('token.sessionCost')}</dt>
          <dd>{formatUsd(sessionCost)}</dd>
        </div>
      </dl>

      <dl className="token-usage-kv">
        <div>
          <dt>{t('token.model')}</dt>
          <dd>{modelLabel || '—'}</dd>
        </div>
        <div>
          <dt>{t('token.provider')}</dt>
          <dd>{providerLabel(modelId, endpoint)}</dd>
        </div>
      </dl>
    </div>
  )
}

function CacheHitChart({ rows }: { rows: TokenSnapshot[] }): React.JSX.Element {
  const t = useT()
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
