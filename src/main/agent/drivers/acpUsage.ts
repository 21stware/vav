import { costToUsd } from '../../../shared/tokenUsage.ts'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function dig(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const key of path.split('.')) {
    const rec = asRecord(cur)
    if (!rec) return undefined
    cur = rec[key]
  }
  return cur
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

/** xAI `costUsdTicks` — 1e10 ticks = $1. */
export const GROK_COST_TICKS_PER_USD = 10_000_000_000

/**
 * Cursor's ACP model ids carry the context window inline:
 * `claude-fable-5[thinking=true,context=300k,effort=high]`,
 * `gpt-5.6-sol[context=272k,reasoning=medium]`. This is the only place the
 * agent reports its window — no usage_update ever arrives — so parse it.
 */
export function contextSizeFromModelId(modelId: string | null | undefined): number | undefined {
  const id = (modelId ?? '').trim()
  if (!id) return undefined
  const m = id.match(/[[,]\s*context\s*=\s*(\d+(?:\.\d+)?)\s*([km])?\b/i)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return undefined
  const unit = (m[2] || '').toLowerCase()
  if (unit === 'k') return Math.round(n * 1_000)
  if (unit === 'm') return Math.round(n * 1_000_000)
  // Bare numbers are already tokens (guard against context=0 noise).
  return n >= 1_024 ? Math.round(n) : undefined
}

export type AcpUsageSample = {
  contextUsed?: number
  contextSize?: number
  inputTokens?: number
  outputTokens?: number
  cacheRead?: number
  cacheWrite?: number
  sessionCostUsd?: number
  turnCostUsd?: number
}

function firstNum(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = num(value)
    if (n != null) return n
  }
  return undefined
}

export function normalizeUpdateKind(kind: string): string {
  return kind.toLowerCase().replace(/[_-]/g, '')
}

export function isAcpSessionUpdateMethod(method: string): boolean {
  const n = method.toLowerCase().replace(/_/g, '')
  return n === 'session/update' || n.endsWith('/session/update')
}

/** Session-level updates that are safe (and required) outside an in-flight turn. */
export function isSessionLevelAcpUpdate(
  kind: string,
  update: Record<string, unknown>
): boolean {
  const n = normalizeUpdateKind(kind)
  return (
    n === 'usageupdate' ||
    n === 'turncompleted' ||
    n === 'availablecommandsupdate' ||
    n === 'currentmodeupdate' ||
    n === 'configoptionupdate' ||
    n === 'sessioninfoupdate' ||
    n === 'goal' ||
    n === 'goalupdate' ||
    update.goal !== undefined ||
    asRecord(update._meta)?.goal !== undefined ||
    asRecord(update.usage) != null
  )
}

function tokenFieldsFrom(record: Record<string, unknown> | null): {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  used?: number
  size?: number
  total?: number
} {
  if (!record) return {}
  return {
    input: firstNum(
      record.inputTokens,
      record.input_tokens,
      record.prompt_tokens,
      record.promptTokens,
      record.input
    ),
    output: firstNum(
      record.outputTokens,
      record.output_tokens,
      record.completion_tokens,
      record.completionTokens,
      record.output
    ),
    cacheRead: firstNum(
      record.cacheRead,
      record.cachedReadTokens,
      record.cached_read_tokens,
      record.cache_read,
      record.cache_read_input_tokens,
      record.cacheReadInputTokens,
      record.cached_tokens,
      record.cachedTokens,
      record.cached
    ),
    cacheWrite: firstNum(
      record.cacheWrite,
      record.cachedWriteTokens,
      record.cached_write_tokens,
      record.cache_write,
      record.cache_creation_input_tokens,
      record.cacheCreationInputTokens,
      record.cacheCreationTokens,
      record.cachedWrite
    ),
    used: firstNum(record.used, record.usedTokens, record.contextUsed),
    size: firstNum(record.size, record.maxTokens, record.contextSize, record.contextWindow),
    total: firstNum(record.totalTokens, record.total_tokens, record.total)
  }
}

function sessionCostFrom(record: Record<string, unknown> | null): number | undefined {
  const cost = asRecord(record?.cost) ?? record
  if (!cost) return undefined
  const amount = firstNum(cost.amount, cost.usd, cost.sessionCostUsd, cost.costUsd)
  if (amount == null) return undefined
  const currency = asString(cost.currency) ?? asString(cost.unit) ?? 'USD'
  return costToUsd(amount, currency) ?? undefined
}

export function costUsdFromTicks(ticks: unknown): number | undefined {
  const n = num(ticks)
  if (n == null || n < 0) return undefined
  return n / GROK_COST_TICKS_PER_USD
}

function turnCostFrom(record: Record<string, unknown> | null): number | undefined {
  if (!record) return undefined
  return (
    costUsdFromTicks(record.costUsdTicks) ??
    costUsdFromTicks(record.cost_usd_ticks) ??
    firstNum(record.turnCostUsd, record.turn_cost_usd)
  )
}

/**
 * Grok ACP prompt / turn_completed `inputTokens` is the full prompt
 * (cache reads included). Split so the snapshot does not double-count.
 */
export function splitInclusivePromptTokens(sample: AcpUsageSample): AcpUsageSample {
  const input = sample.inputTokens
  const cache = sample.cacheRead
  if (input == null || cache == null || cache <= 0 || input < cache) return sample
  const derived = input + cache
  return {
    ...sample,
    inputTokens: input - cache,
    contextUsed:
      sample.contextUsed == null || sample.contextUsed === derived ? input : sample.contextUsed
  }
}

function mergeAcpUsage(...records: Array<Record<string, unknown> | null>): AcpUsageSample | null {
  let input: number | undefined
  let output: number | undefined
  let cacheRead: number | undefined
  let cacheWrite: number | undefined
  let used: number | undefined
  let size: number | undefined
  let total: number | undefined
  let sessionCostUsd: number | undefined
  let turnCostUsd: number | undefined
  for (const record of records) {
    const fields = tokenFieldsFrom(record)
    input ??= fields.input
    output ??= fields.output
    cacheRead ??= fields.cacheRead
    cacheWrite ??= fields.cacheWrite
    used ??= fields.used
    size ??= fields.size
    total ??= fields.total
    sessionCostUsd ??= sessionCostFrom(record)
    turnCostUsd ??= turnCostFrom(record)
  }
  const contextUsed =
    used ??
    ((input ?? 0) + (cacheRead ?? 0) > 0 ? (input ?? 0) + (cacheRead ?? 0) : total)
  if (
    contextUsed == null &&
    size == null &&
    input == null &&
    output == null &&
    cacheRead == null &&
    cacheWrite == null &&
    sessionCostUsd == null &&
    turnCostUsd == null
  ) {
    return null
  }
  return {
    contextUsed,
    contextSize: size,
    inputTokens: input,
    outputTokens: output,
    cacheRead,
    cacheWrite,
    sessionCostUsd,
    turnCostUsd
  }
}

/** Cursor / Grok / other ACP hosts disagree on `usage_update` field names. */
export function readAcpUsageFromUpdate(update: Record<string, unknown>): AcpUsageSample | null {
  const meta = asRecord(update._meta)
  const sample = mergeAcpUsage(
    update,
    asRecord(update.tokens),
    asRecord(update.usage),
    asRecord(update.context),
    meta,
    asRecord(meta?.usage)
  )
  if (!sample) return null
  const kind = normalizeUpdateKind(
    asString(update.sessionUpdate) || asString(update.session_update) || ''
  )
  if (kind === 'turncompleted' || asRecord(update.usage)) {
    return splitInclusivePromptTokens(sample)
  }
  return sample
}

/**
 * Per-turn tokens on `session/prompt` result.
 * Grok: camelCase counts directly on `_meta`.
 * ACP draft: `result.usage` (`inputTokens` / `cachedReadTokens` / …).
 */
export function readAcpUsageFromPromptResult(result: unknown): AcpUsageSample | null {
  const root = asRecord(result)
  if (!root) return null
  const meta = asRecord(root._meta)
  const candidates: Array<Record<string, unknown> | null> = [
    asRecord(root.usage),
    asRecord(meta?.usage),
    asRecord(dig(meta, 'quota.token_count')),
    meta
  ]
  for (const candidate of candidates) {
    const sample = mergeAcpUsage(candidate)
    if (sample) return splitInclusivePromptTokens(sample)
  }
  return null
}
