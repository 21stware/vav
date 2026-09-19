import { QUOTA_EXHAUSTED_PERCENT } from './cliErrors.ts'

/**
 * Composite account health. Missing evidence stays unknown — never invent
 * healthy, unlimited, or success (CPA-Manager-Plus evidence rule).
 */
export type AccountHealthKind = 'ok' | 'capped' | 'resting' | 'needsReauth' | 'unknown'
export type AccountHealthSource = 'quota' | 'credential' | 'balance' | 'none'

export interface AccountHealth {
  kind: AccountHealthKind
  source: AccountHealthSource
  observedAt: number | null
  /** When resting/capped, the exhausted window that keeps the account blocked. */
  resetsAt: number | null
}

export interface AccountHealthInput {
  kind: string
  keyStatus: string
  oauthSignedIn: boolean
  oauthExpired?: boolean
  credentialExpiresAtMs?: number | null
  quotaWindows: Array<{
    usedPercent: number
    resetsAt?: number | null
    updatedAt?: number
  }>
  quotaStatus: string
  quotaUpdatedAt?: number | null
  balance?: { available: boolean } | null
}

export function isAccountRoutable(kind: AccountHealthKind | null | undefined): boolean {
  return kind !== 'resting' && kind !== 'capped' && kind !== 'needsReauth'
}

function latestWindowUpdatedAt(
  windows: AccountHealthInput['quotaWindows']
): number | null {
  let latest = 0
  for (const window of windows) {
    if (typeof window.updatedAt === 'number' && window.updatedAt > latest) latest = window.updatedAt
  }
  return latest > 0 ? latest : null
}

function exhaustedBlock(windows: AccountHealthInput['quotaWindows'], now: number): {
  kind: 'resting' | 'capped'
  resetsAt: number | null
} | null {
  const exhausted = windows.filter(
    (window) => Number.isFinite(window.usedPercent) && window.usedPercent >= QUOTA_EXHAUSTED_PERCENT
  )
  if (!exhausted.length) return null
  const future = exhausted
    .map((window) => window.resetsAt)
    .filter((value): value is number => typeof value === 'number' && value > now)
  if (future.length === exhausted.length) {
    return { kind: 'resting', resetsAt: Math.max(...future) }
  }
  return { kind: 'capped', resetsAt: future.length ? Math.max(...future) : null }
}

/** Pure health synthesis. Callers pass `now` so tests stay deterministic. */
export function accountHealthOf(input: AccountHealthInput, now: number): AccountHealth {
  if (input.kind === 'vav_key' && input.keyStatus === 'invalid') {
    return { kind: 'needsReauth', source: 'credential', observedAt: now, resetsAt: null }
  }
  if (input.kind === 'oauth' && !input.oauthSignedIn && input.oauthExpired === true) {
    return { kind: 'needsReauth', source: 'credential', observedAt: now, resetsAt: null }
  }
  if (
    input.kind === 'oauth' &&
    typeof input.credentialExpiresAtMs === 'number' &&
    input.credentialExpiresAtMs > 0 &&
    input.credentialExpiresAtMs <= now &&
    !input.oauthSignedIn
  ) {
    return {
      kind: 'needsReauth',
      source: 'credential',
      observedAt: input.credentialExpiresAtMs,
      resetsAt: null
    }
  }
  if (input.balance && input.balance.available === false) {
    return { kind: 'capped', source: 'balance', observedAt: now, resetsAt: null }
  }

  const windows = input.quotaWindows
  const block = exhaustedBlock(windows, now)
  if (block) {
    return {
      kind: block.kind,
      source: 'quota',
      observedAt: latestWindowUpdatedAt(windows) ?? input.quotaUpdatedAt ?? now,
      resetsAt: block.resetsAt
    }
  }
  if (windows.length > 0) {
    return {
      kind: 'ok',
      source: 'quota',
      observedAt: latestWindowUpdatedAt(windows) ?? input.quotaUpdatedAt ?? now,
      resetsAt: null
    }
  }

  if (input.kind === 'vav_key' && input.keyStatus === 'ok') {
    return { kind: 'ok', source: 'credential', observedAt: now, resetsAt: null }
  }
  if (input.oauthSignedIn && input.quotaStatus === 'error') {
    return {
      kind: 'unknown',
      source: 'quota',
      observedAt: input.quotaUpdatedAt ?? now,
      resetsAt: null
    }
  }
  if (input.oauthSignedIn) {
    return {
      kind: 'unknown',
      source: input.quotaStatus === 'none' ? 'none' : 'quota',
      observedAt: input.quotaUpdatedAt ?? null,
      resetsAt: null
    }
  }
  return { kind: 'unknown', source: 'none', observedAt: null, resetsAt: null }
}

export function applyAccountHealth<
  T extends AccountHealthInput & {
    healthKind?: AccountHealthKind
    healthSource?: AccountHealthSource
    healthObservedAt?: number | null
    healthResetsAt?: number | null
  }
>(account: T, now: number): T {
  const health = accountHealthOf(account, now)
  return {
    ...account,
    healthKind: health.kind,
    healthSource: health.source,
    healthObservedAt: health.observedAt,
    healthResetsAt: health.resetsAt
  }
}

export function pickRoutableAccountId<
  T extends {
    id: string
    current: boolean
    healthKind?: AccountHealthKind | null
  }
>(rows: T[]): string | null {
  if (!rows.length) return null
  const current = rows.find((row) => row.current)
  if (current && isAccountRoutable(current.healthKind)) return current.id
  const healthy = rows.find((row) => isAccountRoutable(row.healthKind))
  return healthy?.id ?? current?.id ?? rows[0]?.id ?? null
}
