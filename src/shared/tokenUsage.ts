import type { DisplayCurrency, TokenSnapshot } from './types'
import { t, type AppLocale } from './i18n'

/** Anthropic prompt-cache TTL used for expiry display. */
export const CACHE_TTL_MS = 5 * 60_000

/** Keep at most this many snapshots per conversation. */
export const TOKEN_HISTORY_LIMIT = 30

/** Popover chart shows the newest N points. */
export const TOKEN_CHART_POINTS = 10

export interface ModelRates {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

/** $/MTok — Sonnet 4 reference; other providers scale lightly. */
export function ratesForModel(modelId: string): ModelRates {
  const id = modelId.toLowerCase()
  if (id.includes('opus')) {
    return { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 }
  }
  if (id.includes('haiku')) {
    return { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 }
  }
  if (id.includes('gpt') || id.includes('openai')) {
    return { input: 2.5, output: 10, cacheWrite: 2.5, cacheRead: 1.25 }
  }
  if (id.includes('deepseek')) {
    return { input: 0.27, output: 1.1, cacheWrite: 0.27, cacheRead: 0.07 }
  }
  // Sonnet 4 / default (main-chat.rpml §花费计算)
  return { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }
}

export function providerLabel(modelId: string, endpoint: string): string {
  const id = modelId.toLowerCase()
  const ep = endpoint.toLowerCase()
  if (id.includes('deepseek') || ep.includes('deepseek')) return 'DeepSeek'
  if (id.includes('gpt') || ep.includes('openai')) return 'OpenAI'
  if (id.includes('claude') || id.includes('sonnet') || id.includes('opus') || id.includes('haiku')) {
    return 'Anthropic'
  }
  if (ep.includes('anthropic')) return 'Anthropic'
  if (ep.includes('openai')) return 'OpenAI'
  return 'Custom'
}

export function modelDisplayName(modelId: string, label?: string): string {
  if (label) return label
  if (modelId.includes('sonnet')) return 'Sonnet 4'
  if (modelId.includes('opus')) return 'Opus 4'
  if (modelId.includes('haiku')) return 'Haiku 3.5'
  return modelId
}

export function estimateCost(
  parts: {
    newInputTokens: number
    outputTokens: number
    cacheWriteTokens: number
    cacheReadTokens: number
  },
  rates: ModelRates
): number {
  const perM = 1_000_000
  return (
    (parts.newInputTokens * rates.input +
      parts.outputTokens * rates.output +
      parts.cacheWriteTokens * rates.cacheWrite +
      parts.cacheReadTokens * rates.cacheRead) /
    perM
  )
}

export function cacheHitPercent(snapshot: TokenSnapshot): number {
  const total = snapshot.totalInputTokens
  if (total <= 0) return 0
  return (snapshot.cacheReadTokens / total) * 100
}

export function buildSnapshot(input: {
  turnIndex: number
  usage: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
  modelId: string
  timestamp?: number
}): TokenSnapshot {
  const cacheReadTokens = Math.max(0, input.usage.cacheRead)
  const cacheWriteTokens = Math.max(0, input.usage.cacheWrite)
  const newInputTokens = Math.max(0, input.usage.input)
  const outputTokens = Math.max(0, input.usage.output)
  const totalInputTokens = newInputTokens + cacheReadTokens
  const timestamp = input.timestamp ?? Date.now()
  const estimatedCost = estimateCost(
    { newInputTokens, outputTokens, cacheWriteTokens, cacheReadTokens },
    ratesForModel(input.modelId)
  )
  return {
    turnIndex: input.turnIndex,
    totalInputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    newInputTokens,
    outputTokens,
    timestamp,
    estimatedCost
  }
}

export function sessionCostOf(history: TokenSnapshot[]): number {
  return history.reduce((sum, row) => sum + row.estimatedCost, 0)
}

/**
 * Approximate USD→currency multipliers for estimate display only.
 * Not live FX — costs remain rough provider-rate estimates.
 */
const USD_TO: Record<DisplayCurrency, number> = {
  USD: 1,
  CNY: 7.25,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 150,
  HKD: 7.8,
  TWD: 32,
  KRW: 1350,
  SGD: 1.35,
  AUD: 1.55,
  CAD: 1.38
}

const CURRENCY_LOCALE: Record<DisplayCurrency, string> = {
  USD: 'en-US',
  CNY: 'zh-CN',
  EUR: 'de-DE',
  GBP: 'en-GB',
  JPY: 'ja-JP',
  HKD: 'zh-HK',
  TWD: 'zh-TW',
  KRW: 'ko-KR',
  SGD: 'en-SG',
  AUD: 'en-AU',
  CAD: 'en-CA'
}

/** @deprecated Prefer {@link formatCost}. Kept for call sites that assume USD. */
export function formatUsd(amount: number): string {
  return formatCost(amount, 'USD')
}

/** Format an estimated USD cost in the user's display currency. */
export function formatCost(amountUsd: number, currency: DisplayCurrency = 'USD'): string {
  const rate = USD_TO[currency] ?? 1
  const amount = amountUsd * rate
  const zeroFraction = currency === 'JPY' || currency === 'KRW'
  const maxFrac = amount <= 0 ? (zeroFraction ? 0 : 2) : amount < 0.01 && !zeroFraction ? 4 : zeroFraction ? 0 : 2
  const minFrac = amount <= 0 ? (zeroFraction ? 0 : 2) : amount < 0.01 && !zeroFraction ? 4 : zeroFraction ? 0 : 2
  try {
    const formatted = new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: minFrac,
      maximumFractionDigits: maxFrac
    }).format(Math.max(0, amount))
    return `~${formatted}`
  } catch {
    if (amount <= 0) return `~${currency} 0.00`
    return `~${currency} ${amount.toFixed(maxFrac)}`
  }
}

export function formatClock(ts: number | null | undefined, locale = 'en'): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    month: 'numeric',
    day: 'numeric'
  })
}

export function formatExpiry(
  expiresAt: number | null | undefined,
  now = Date.now(),
  locale: AppLocale = 'en'
): string {
  if (!expiresAt) return '—'
  const clock = formatClock(expiresAt, locale)
  const remain = expiresAt - now
  if (remain <= 0) return t(locale, 'time.clockExpired', { clock })
  const mins = Math.max(1, Math.round(remain / 60_000))
  return t(locale, 'time.clockInMinutes', { clock, mins })
}
