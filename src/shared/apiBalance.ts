export type AnalysisApiBalanceSource = 'deepseek'

export interface AnalysisApiBalance {
  source: AnalysisApiBalanceSource
  currency: string
  total: number
  granted: number
  toppedUp: number
  available: boolean
}

const OFFICIAL_DEEPSEEK_HOSTS = new Set(['api.deepseek.com', 'api.deepseek.ai'])

/**
 * Official DeepSeek origin only — never send the VAV key to a lookalike host.
 * Chat mount (`/v1`, `/anthropic`) does not matter; balance lives at `/user/balance`.
 */
export function deepseekBalanceUrl(apiEndpoint: string): string | null {
  const raw = apiEndpoint.trim()
  if (!raw) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (!OFFICIAL_DEEPSEEK_HOSTS.has(url.hostname.toLowerCase())) return null
    return `${url.protocol}//${url.host}/user/balance`
  } catch {
    return null
  }
}

function parseMoney(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const n = Number(value.trim())
  return Number.isFinite(n) ? n : null
}

/** `GET /user/balance` — amounts are decimal strings in the official schema. */
export function parseDeepSeekBalance(payload: unknown): AnalysisApiBalance | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const rec = payload as Record<string, unknown>
  const available = rec.is_available !== false
  const infos = Array.isArray(rec.balance_infos) ? rec.balance_infos : []
  let best: AnalysisApiBalance | null = null
  for (const row of infos) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const info = row as Record<string, unknown>
    const currency = typeof info.currency === 'string' ? info.currency.trim() : ''
    const total = parseMoney(info.total_balance)
    if (!currency || total == null) continue
    const next: AnalysisApiBalance = {
      source: 'deepseek',
      currency,
      total,
      granted: parseMoney(info.granted_balance) ?? 0,
      toppedUp: parseMoney(info.topped_up_balance) ?? 0,
      available
    }
    if (!best || next.total > best.total) best = next
  }
  if (best) return best
  if (typeof rec.is_available === 'boolean') {
    return {
      source: 'deepseek',
      currency: 'USD',
      total: 0,
      granted: 0,
      toppedUp: 0,
      available: rec.is_available
    }
  }
  return null
}

export function formatApiBalanceAmount(balance: AnalysisApiBalance): string {
  const currency = /^[A-Z]{3}$/.test(balance.currency) ? balance.currency : 'USD'
  const locale = currency === 'CNY' ? 'zh-CN' : 'en-US'
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(balance.total)
  } catch {
    return `${currency} ${balance.total.toFixed(2)}`
  }
}

export function apiBalanceProviderLabel(source: AnalysisApiBalanceSource): string {
  if (source === 'deepseek') return 'DeepSeek'
  return source
}
