import type { CliHostKind } from './cliHost'
import type { QuotaWindow, QuotaWindowKind } from './types'

/** Hosts that expose an account-level subscription / rate-limit poll. */
export const ACCOUNT_QUOTA_HOSTS = ['claude', 'codex', 'cursor', 'grok', 'opencode'] as const
export type AccountQuotaHost = (typeof ACCOUNT_QUOTA_HOSTS)[number]

const ACCOUNT_QUOTA_HOST_SET = new Set<string>(ACCOUNT_QUOTA_HOSTS)

export function hostMayHaveAccountQuota(
  host: CliHostKind | string | null | undefined
): host is AccountQuotaHost {
  return typeof host === 'string' && ACCOUNT_QUOTA_HOST_SET.has(host)
}

/** Cache / stamp key: one subscription per host login, never shared. */
export function quotaIdentityOf(identity: string | null | undefined): string {
  return (identity ?? '').trim().toLowerCase()
}

export function quotaNamespace(
  host: string,
  identity: string | null | undefined
): string {
  return `${host}:${quotaIdentityOf(identity)}`
}

export function attachQuotaNamespace(
  windows: QuotaWindow[],
  host: string,
  identity: string | null | undefined
): QuotaWindow[] {
  const ns = quotaNamespace(host, identity)
  return windows.map((window) => ({ ...window, ns }))
}

/**
 * Windows stamped for this host+identity only.
 * Signed-out / unknown identity, or a sample from another login, is empty.
 */
export function selectQuotaWindows(
  windows: QuotaWindow[] | null | undefined,
  host: string,
  identity: string | null | undefined
): QuotaWindow[] {
  const id = quotaIdentityOf(identity)
  if (!id) return []
  const ns = quotaNamespace(host, id)
  return (windows ?? []).filter((window) => window.ns === ns)
}

export function mergeNamespacedQuotaWindows(
  host: string,
  identity: string | null | undefined,
  ...sources: Array<QuotaWindow[] | null | undefined>
): QuotaWindow[] {
  if (!quotaIdentityOf(identity)) return []
  let merged: QuotaWindow[] = []
  for (const source of sources) {
    merged = mergeQuotaWindowsPreferNewer(merged, selectQuotaWindows(source, host, identity))
  }
  return merged
}

const QUOTA_KIND_ORDER: Record<QuotaWindowKind, number> = {
  five_hour: 0,
  seven_day: 1,
  seven_day_opus: 2,
  seven_day_sonnet: 3,
  cursor_api: 4,
  cursor_auto: 5,
  monthly: 6,
  primary: 7,
  secondary: 8,
  other: 9
}

/**
 * Host percents are already 0–100 (Claude `utilization` / `used_percentage`,
 * Codex `usedPercent`). Clamp only — treating ≤1 as a 0–1 fraction turns a
 * real 0.8% / 1% weekly window into 80% / 100%.
 */
export function normalizeQuotaPercent(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null
  return Math.min(100, Math.max(0, value))
}

/** Unix seconds → ms; already-ms values pass through. */
export function normalizeQuotaResetsAt(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  // 1e10 sits between any plausible seconds epoch (<2286) and any millisecond epoch (>2001).
  return value > 10_000_000_000 ? Math.round(value) : Math.round(value * 1000)
}

/** Number, numeric string, or ISO timestamp → ms. */
export function parseQuotaResetsAt(value: unknown): number | null {
  if (typeof value === 'number') return normalizeQuotaResetsAt(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric) && trimmed !== '') {
    return normalizeQuotaResetsAt(numeric)
  }
  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function quotaKindFromClaudeType(raw: string | null | undefined): QuotaWindowKind {
  const id = (raw ?? '').toLowerCase().replace(/-/g, '_')
  if (id === 'five_hour' || id === 'fivehour') return 'five_hour'
  if (
    id === 'seven_day_opus' ||
    id === 'seven_day_opus_limit' ||
    id === 'fable_weekly' ||
    id === 'fable_seven_day' ||
    id === 'seven_day_fable'
  ) {
    return 'seven_day_opus'
  }
  if (id === 'seven_day_sonnet' || id === 'seven_day_sonnet_limit') return 'seven_day_sonnet'
  if (id === 'seven_day' || id === 'seven_day_limit' || id === 'weekly') return 'seven_day'
  return 'other'
}

export const CODEX_SESSION_WINDOW_MINUTES = 300
export const CODEX_WEEKLY_WINDOW_MINUTES = 10080
const CODEX_WINDOW_DURATION_TOLERANCE_MINUTES = 1

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Codex app-server uses `windowDurationMins`; backend uses `limit_window_seconds`. */
export function codexWindowMinutesFromRecord(
  rec: Record<string, unknown> | null | undefined
): number | null {
  if (!rec) return null
  const direct =
    finitePositiveNumber(rec.windowDurationMins) ??
    finitePositiveNumber(rec.window_duration_mins) ??
    finitePositiveNumber(rec.window_minutes) ??
    finitePositiveNumber(rec.windowMinutes)
  if (direct != null) return direct
  const seconds =
    finitePositiveNumber(rec.limit_window_seconds) ??
    finitePositiveNumber(rec.limitWindowSeconds) ??
    finitePositiveNumber(rec.window_duration_seconds)
  return seconds != null ? Math.ceil(seconds / 60) : null
}

export function classifyCodexWindowDuration(
  windowMinutes: number | null | undefined
): 'five_hour' | 'seven_day' | null {
  if (typeof windowMinutes !== 'number' || !Number.isFinite(windowMinutes)) return null
  if (Math.abs(windowMinutes - CODEX_SESSION_WINDOW_MINUTES) <= CODEX_WINDOW_DURATION_TOLERANCE_MINUTES) {
    return 'five_hour'
  }
  if (Math.abs(windowMinutes - CODEX_WEEKLY_WINDOW_MINUTES) <= CODEX_WINDOW_DURATION_TOLERANCE_MINUTES) {
    return 'seven_day'
  }
  return null
}

function fallbackCodexKind(key: string): QuotaWindowKind {
  const k = key.toLowerCase()
  if (k === 'secondary') return 'seven_day'
  if (k === 'primary') return 'five_hour'
  return 'other'
}

/**
 * Classify one Codex window. Prefer canonical 5h / weekly durations (±1 min);
 * unknown lengths keep Orca's primary→session, secondary→weekly mapping.
 */
export function quotaKindFromCodexWindow(
  key: string,
  windowMinutes: number | null | undefined
): QuotaWindowKind {
  return classifyCodexWindowDuration(windowMinutes) ?? fallbackCodexKind(key)
}

export type CodexRateLimitWindowPair = {
  primary: { minutes: number | null } | null
  secondary: { minutes: number | null } | null
}

/**
 * Classify a primary/secondary pair together so a duration-matched weekly
 * window is not also labeled weekly via the secondary fallback.
 */
export function classifyCodexRateLimitWindowKinds(input: CodexRateLimitWindowPair): {
  primary: QuotaWindowKind | null
  secondary: QuotaWindowKind | null
} {
  let sessionSource: 'primary' | 'secondary' | null = null
  let weeklySource: 'primary' | 'secondary' | null = null

  for (const key of ['primary', 'secondary'] as const) {
    const window = input[key]
    if (!window) continue
    const kind = classifyCodexWindowDuration(window.minutes)
    if (kind === 'five_hour' && !sessionSource) sessionSource = key
    else if (kind === 'seven_day' && !weeklySource) weeklySource = key
  }

  if (!sessionSource && input.primary && classifyCodexWindowDuration(input.primary.minutes) === null) {
    sessionSource = 'primary'
  }
  if (!weeklySource && input.secondary && classifyCodexWindowDuration(input.secondary.minutes) === null) {
    weeklySource = 'secondary'
  }

  const kindFor = (key: 'primary' | 'secondary'): QuotaWindowKind | null => {
    if (sessionSource === key) return 'five_hour'
    if (weeklySource === key) return 'seven_day'
    return null
  }
  return { primary: kindFor('primary'), secondary: kindFor('secondary') }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function canonicalizeQuotaWindow(window: QuotaWindow): QuotaWindow | null {
  if (!window?.id || !Number.isFinite(window.usedPercent)) return null
  const pct = normalizeQuotaPercent(window.usedPercent)
  if (pct == null) return null
  const ns = typeof window.ns === 'string' && window.ns.trim() ? window.ns.trim() : undefined
  return {
    ...window,
    usedPercent: pct,
    resetsAt: parseQuotaResetsAt(window.resetsAt) ?? window.resetsAt ?? null,
    ...(ns ? { ns } : {})
  }
}

function sortQuotaWindows(windows: QuotaWindow[]): QuotaWindow[] {
  return [...windows].sort(
    (a, b) =>
      (QUOTA_KIND_ORDER[a.kind] ?? 99) - (QUOTA_KIND_ORDER[b.kind] ?? 99) ||
      a.id.localeCompare(b.id)
  )
}

function quotaWindowFromRaw(
  raw: unknown,
  kind: QuotaWindowKind,
  now: number
): QuotaWindow | null {
  const rec = asRecord(raw)
  if (!rec) return null
  const pct =
    normalizeQuotaPercent(finiteNumber(rec.utilization) ?? NaN) ??
    normalizeQuotaPercent(finiteNumber(rec.used_percentage) ?? NaN) ??
    normalizeQuotaPercent(finiteNumber(rec.usedPercentage) ?? NaN) ??
    normalizeQuotaPercent(finiteNumber(rec.used_percent) ?? NaN) ??
    normalizeQuotaPercent(finiteNumber(rec.usedPercent) ?? NaN) ??
    normalizeQuotaPercent(finiteNumber(rec.percent) ?? NaN)
  if (pct == null) return null
  return {
    id: kind,
    kind,
    usedPercent: pct,
    resetsAt: parseQuotaResetsAt(
      rec.resets_at ?? rec.resetsAt ?? rec.reset_at ?? rec.resetAt
    ),
    updatedAt: now
  }
}

function fableWeeklyFromClaudeOAuth(data: Record<string, unknown>, now: number): QuotaWindow | null {
  const limits = Array.isArray(data.limits) ? data.limits : []
  const scoped = limits
    .map((row) => asRecord(row))
    .find((limit) => {
      if (!limit || limit.kind !== 'weekly_scoped') return false
      const scope = asRecord(limit.scope)
      const model = asRecord(scope?.model)
      const name = typeof model?.display_name === 'string' ? model.display_name.trim().toLowerCase() : ''
      return name === 'fable'
    })
  return (
    quotaWindowFromRaw(scoped, 'seven_day_opus', now) ??
    quotaWindowFromRaw(data.fable_weekly, 'seven_day_opus', now) ??
    quotaWindowFromRaw(data.fable_seven_day, 'seven_day_opus', now) ??
    quotaWindowFromRaw(data.seven_day_fable, 'seven_day_opus', now)
  )
}

/** Map Anthropic `GET /api/oauth/usage` JSON onto VAV quota windows. */
export function windowsFromClaudeOAuthPayload(
  payload: unknown,
  now = Date.now()
): QuotaWindow[] {
  const data = asRecord(payload)
  if (!data) return []
  const windows = [
    quotaWindowFromRaw(data.five_hour, 'five_hour', now),
    quotaWindowFromRaw(data.seven_day, 'seven_day', now),
    fableWeeklyFromClaudeOAuth(data, now)
  ].filter((row): row is QuotaWindow => row != null)
  return sortQuotaWindows(windows)
}

/** Map Codex `GET /backend-api/wham/usage` JSON onto VAV quota windows. */
export function windowsFromCodexBackendPayload(
  payload: unknown,
  now = Date.now()
): QuotaWindow[] {
  const data = asRecord(payload)
  if (!data) return []
  const rateLimit = asRecord(data.rate_limit) ?? asRecord(data.rateLimit)
  if (!rateLimit) return []
  const primary = asRecord(rateLimit?.primary_window)
  const secondary = asRecord(rateLimit?.secondary_window)
  const primaryPct =
    normalizeQuotaPercent(finiteNumber(primary?.used_percent) ?? finiteNumber(primary?.usedPercent) ?? NaN)
  const secondaryPct =
    normalizeQuotaPercent(
      finiteNumber(secondary?.used_percent) ?? finiteNumber(secondary?.usedPercent) ?? NaN
    )
  const kinds = classifyCodexRateLimitWindowKinds({
    primary: primary && primaryPct != null ? { minutes: codexWindowMinutesFromRecord(primary) } : null,
    secondary:
      secondary && secondaryPct != null ? { minutes: codexWindowMinutesFromRecord(secondary) } : null
  })
  const windows: QuotaWindow[] = []
  const rows: Array<{ key: 'primary' | 'secondary'; rec: Record<string, unknown> | null; pct: number | null }> =
    [
      { key: 'primary', rec: primary, pct: primaryPct },
      { key: 'secondary', rec: secondary, pct: secondaryPct }
    ]
  for (const row of rows) {
    if (!row.rec || row.pct == null) continue
    const kind = kinds[row.key]
    if (!kind) continue
    windows.push({
      id: kind,
      kind,
      usedPercent: row.pct,
      resetsAt: parseQuotaResetsAt(row.rec.reset_at ?? row.rec.resetsAt ?? row.rec.resets_at),
      updatedAt: now
    })
  }
  return sortQuotaWindows(windows)
}

function grokConfigFromPayload(payload: unknown): Record<string, unknown> | null {
  const data = asRecord(payload)
  if (!data) return null
  const nested = asRecord(data.config)
  if (nested) return nested
  if (typeof data.creditUsagePercent === 'number') return data
  if (asRecord(data.monthlyLimit) || asRecord(data.used)) return data
  return null
}

function grokPeriod(config: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(config.currentPeriod)
}

function grokTimestampsMatch(left: unknown, right: unknown): boolean {
  const a = typeof left === 'string' ? Date.parse(left) : Number.NaN
  const b = typeof right === 'string' ? Date.parse(right) : Number.NaN
  return Number.isFinite(a) && a === b
}

function grokHasConfirmedWeeklyPeriod(config: Record<string, unknown>): boolean {
  const period = grokPeriod(config)
  return (
    period?.type === 'USAGE_PERIOD_TYPE_WEEKLY' &&
    grokTimestampsMatch(period.start, config.billingPeriodStart) &&
    grokTimestampsMatch(period.end, config.billingPeriodEnd)
  )
}

function grokMoneyVal(value: unknown): number | null {
  const rec = asRecord(value)
  const raw = rec?.val
  const num = typeof raw === 'string' ? Number.parseFloat(raw) : finiteNumber(raw)
  return num != null && Number.isFinite(num) ? num : null
}

function grokWeeklyWindow(config: Record<string, unknown>, now: number): QuotaWindow | null {
  const used =
    config.creditUsagePercent === undefined && grokHasConfirmedWeeklyPeriod(config)
      ? 0
      : finiteNumber(config.creditUsagePercent)
  const pct = normalizeQuotaPercent(used ?? NaN)
  if (pct == null) return null
  const period = grokPeriod(config)
  const periodEnd = period?.end ?? config.billingPeriodEnd
  return {
    id: 'seven_day',
    kind: 'seven_day',
    usedPercent: pct,
    resetsAt: parseQuotaResetsAt(periodEnd),
    updatedAt: now
  }
}

function grokMonthlyWindow(config: Record<string, unknown>, now: number): QuotaWindow | null {
  const limit = grokMoneyVal(config.monthlyLimit)
  const used = grokMoneyVal(config.used)
  if (limit == null || used == null || limit <= 0) return null
  const pct = normalizeQuotaPercent((used / limit) * 100)
  if (pct == null) return null
  const period = grokPeriod(config)
  const periodEnd = period?.end ?? config.billingPeriodEnd
  return {
    id: 'monthly',
    kind: 'monthly',
    usedPercent: pct,
    resetsAt: parseQuotaResetsAt(periodEnd),
    updatedAt: now
  }
}

/** Map Grok CLI `GET /v1/billing` JSON onto VAV quota windows. */
export function windowsFromGrokBillingPayload(
  payload: unknown,
  now = Date.now()
): QuotaWindow[] {
  const config = grokConfigFromPayload(payload)
  if (!config) return []
  const windows = [grokWeeklyWindow(config, now), grokMonthlyWindow(config, now)].filter(
    (row): row is QuotaWindow => row != null
  )
  return sortQuotaWindows(windows)
}

/** Cursor CLI `POST …/GetCurrentPeriodUsage` — two monthly pools. */
export function windowsFromCursorPeriodPayload(
  payload: unknown,
  now = Date.now()
): QuotaWindow[] {
  const data = asRecord(payload)
  const plan = asRecord(data?.planUsage)
  if (!plan) return []
  const resetsAt = parseQuotaResetsAt(data?.billingCycleEnd)
  const named = normalizeQuotaPercent(finiteNumber(plan.apiPercentUsed) ?? NaN)
  const firstParty = normalizeQuotaPercent(finiteNumber(plan.autoPercentUsed) ?? NaN)
  const windows: QuotaWindow[] = []
  if (named != null) {
    windows.push({
      id: 'cursor_api',
      kind: 'cursor_api',
      usedPercent: named,
      resetsAt,
      updatedAt: now
    })
  }
  if (firstParty != null) {
    windows.push({
      id: 'cursor_auto',
      kind: 'cursor_auto',
      usedPercent: firstParty,
      resetsAt,
      updatedAt: now
    })
  }
  if (windows.length > 0) return sortQuotaWindows(windows)
  const pct = normalizeQuotaPercent(finiteNumber(plan.totalPercentUsed) ?? NaN)
  if (pct == null) return []
  return [
    {
      id: 'monthly',
      kind: 'monthly',
      usedPercent: pct,
      resetsAt,
      updatedAt: now
    }
  ]
}

const OPENCODE_GO_LANES: Array<{ key: string; kind: QuotaWindowKind }> = [
  { key: 'rolling', kind: 'five_hour' },
  { key: 'weekly', kind: 'seven_day' },
  { key: 'monthly', kind: 'monthly' }
]

/** OpenCode Go `GET /zen/go/v1/usage`. */
export function windowsFromOpencodeGoUsagePayload(
  payload: unknown,
  now = Date.now()
): QuotaWindow[] {
  const usage = asRecord(asRecord(payload)?.usage)
  if (!usage) return []
  const windows: QuotaWindow[] = []
  for (const lane of OPENCODE_GO_LANES) {
    const rec = asRecord(usage[lane.key])
    const pct = normalizeQuotaPercent(finiteNumber(rec?.percent) ?? NaN)
    if (!rec || pct == null) continue
    windows.push({
      id: lane.kind,
      kind: lane.kind,
      usedPercent: pct,
      resetsAt: parseQuotaResetsAt(rec.resetsAt ?? rec.resets_at),
      updatedAt: now
    })
  }
  return sortQuotaWindows(windows)
}

export function mergeQuotaWindows(
  prev: QuotaWindow[] | null | undefined,
  incoming: QuotaWindow[]
): QuotaWindow[] {
  const map = new Map<string, QuotaWindow>()
  for (const w of prev ?? []) {
    const next = canonicalizeQuotaWindow(w)
    if (next) map.set(next.id, next)
  }
  for (const w of incoming) {
    const next = canonicalizeQuotaWindow(w)
    if (next) map.set(next.id, next)
  }
  return sortQuotaWindows([...map.values()])
}

/** Newest sample per host from parked + active conversation quota windows. */
export function latestQuotaWindowsByHost(
  conversations: Array<{
    cliHost?: string | null
    quotaWindows?: QuotaWindow[] | null
    hostTranscripts?: Record<string, { quotaWindows?: QuotaWindow[] | null }>
  }>
): Map<string, QuotaWindow[]> {
  const out = new Map<string, QuotaWindow[]>()
  const consider = (host: string | null | undefined, windows: QuotaWindow[] | null | undefined): void => {
    if (!host || !hostMayHaveAccountQuota(host) || !windows?.length) return
    const prev = out.get(host)
    out.set(host, prev ? mergeQuotaWindowsPreferNewer(prev, windows) : windows)
  }
  for (const conversation of conversations) {
    consider(conversation.cliHost, conversation.quotaWindows)
    for (const [key, bucket] of Object.entries(conversation.hostTranscripts ?? {})) {
      consider(key, bucket.quotaWindows)
    }
  }
  return out
}

/** Account poll + live stream: keep the newer sample per window id. */
export function mergeQuotaWindowsPreferNewer(
  account: QuotaWindow[] | null | undefined,
  live: QuotaWindow[] | null | undefined
): QuotaWindow[] {
  const map = new Map<string, QuotaWindow>()
  for (const w of [...(account ?? []), ...(live ?? [])]) {
    const next = canonicalizeQuotaWindow(w)
    if (!next) continue
    const prev = map.get(next.id)
    if (!prev || (next.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) {
      map.set(next.id, next)
    }
  }
  return sortQuotaWindows([...map.values()])
}
