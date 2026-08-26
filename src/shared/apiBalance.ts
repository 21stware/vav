export type AnalysisApiBalanceSource = 'deepseek' | 'openrouter'

export interface AnalysisApiBalance {
  source: AnalysisApiBalanceSource
  currency: string
  total: number
  granted: number
  toppedUp: number
  available: boolean
}

const OFFICIAL_DEEPSEEK_HOSTS = new Set(['api.deepseek.com', 'api.deepseek.ai'])
const OFFICIAL_OPENROUTER_HOSTS = new Set(['openrouter.ai'])

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

function officialOrigin(apiEndpoint: string, hosts: Set<string>): string | null {
  const raw = apiEndpoint.trim()
  if (!raw) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (!hosts.has(url.hostname.toLowerCase())) return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

/**
 * Official OpenRouter origin only. Wallet is `/api/v1/credits`;
 * `/api/v1/key` is the fallback that regular inference keys can read.
 */
export function openrouterCreditsUrl(apiEndpoint: string): string | null {
  const origin = officialOrigin(apiEndpoint, OFFICIAL_OPENROUTER_HOSTS)
  return origin ? `${origin}/api/v1/credits` : null
}

export function openrouterKeyUrl(apiEndpoint: string): string | null {
  const origin = officialOrigin(apiEndpoint, OFFICIAL_OPENROUTER_HOSTS)
  return origin ? `${origin}/api/v1/key` : null
}

/** First official balance URL for this endpoint, if any. */
export function apiBalanceUrl(apiEndpoint: string): string | null {
  return deepseekBalanceUrl(apiEndpoint) ?? openrouterCreditsUrl(apiEndpoint)
}

/** Prepaid API vendors that expose a wallet (DeepSeek, OpenRouter, legacy VAV). */
export function hostCanShowApiBalance(hostKey: string): boolean {
  return hostKey === 'vav' || hostKey === 'deepseek' || hostKey === 'openrouter'
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

export function parseOpenRouterCredits(payload: unknown): AnalysisApiBalance | null {
  const data = creditDataOf(payload)
  if (!data) return null
  const credits = parseMoney(data.total_credits)
  const usage = parseMoney(data.total_usage)
  if (credits == null || usage == null) return null
  const remaining = Math.max(0, credits - usage)
  return {
    source: 'openrouter',
    currency: 'USD',
    total: remaining,
    granted: 0,
    toppedUp: credits,
    available: remaining > 0
  }
}

/** `GET /api/v1/key` — per-key remaining when the wallet endpoint is locked. */
export function parseOpenRouterKey(payload: unknown): AnalysisApiBalance | null {
  const data = creditDataOf(payload)
  if (!data) return null
  const remaining = parseMoney(data.limit_remaining)
  if (remaining == null) return null
  return {
    source: 'openrouter',
    currency: 'USD',
    total: remaining,
    granted: 0,
    toppedUp: parseMoney(data.limit) ?? remaining,
    available: remaining > 0
  }
}

function creditDataOf(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const rec = payload as Record<string, unknown>
  if (rec.data && typeof rec.data === 'object' && !Array.isArray(rec.data)) {
    return rec.data as Record<string, unknown>
  }
  return rec
}

export function apiBalanceProviderLabel(source: AnalysisApiBalanceSource): string {
  if (source === 'deepseek') return 'DeepSeek'
  if (source === 'openrouter') return 'OpenRouter'
  return source
}
