import {
  classifyCliError,
  NETWORK_RETRY_LIMIT,
  networkRetryDelayMs,
  shouldRetrySameSession,
  type CliErrorKind
} from './cliErrors.ts'
import type { TurnPhase, TurnRecovery, TurnRecoveryKind } from './types.ts'

/** Faster ladder for stream/protocol bugs than for a dead socket. */
const TECHNICAL_RETRY_DELAYS_MS = [400, 1_000, 2_500] as const

export function isRecoveryPhase(phase: TurnPhase): phase is TurnRecoveryKind {
  return phase === 'retrying' || phase === 'reconnecting' || phase === 'healing'
}

export function isLiveStreamPhase(phase: TurnPhase): boolean {
  return (
    phase === 'outputting' ||
    phase === 'thinking' ||
    phase === 'working' ||
    isRecoveryPhase(phase)
  )
}

export function recoveryEqual(
  a: TurnRecovery | null | undefined,
  b: TurnRecovery | null | undefined
): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.kind === b.kind && a.attempt === b.attempt && a.limit === b.limit
}

export function recoveryRetryLimit(_kind?: CliErrorKind): number {
  return NETWORK_RETRY_LIMIT
}

export function recoveryRetryDelayMs(kind: CliErrorKind, attempt: number): number {
  if (kind === 'technical') {
    const index = Math.min(Math.max(1, attempt), TECHNICAL_RETRY_DELAYS_MS.length) - 1
    return TECHNICAL_RETRY_DELAYS_MS[index]!
  }
  return networkRetryDelayMs(attempt)
}

export type SameSessionRecoveryPlan = {
  phase: TurnRecoveryKind
  prepareReplayFromBlocks: boolean
  continueWithoutReprompt: boolean
  recovery: TurnRecovery
}

/** Map a live host `transport` event onto the recovery chrome the UI shows. */
export function recoveryFromTransportEvent(
  event: { status: TurnRecoveryKind; attempt?: number; limit?: number },
  networkRetries: number
): TurnRecovery {
  return {
    kind: event.status,
    attempt: event.attempt ?? networkRetries + 1,
    limit: event.limit ?? NETWORK_RETRY_LIMIT
  }
}

/**
 * Mid-turn Codex / Claude retry strings: parse progress, then pick the same
 * phase the settle ladder would use so chrome stays consistent.
 */
export function planHostRecoveryUi(opts: {
  raw: string
  keepPartial: boolean
  processDied?: boolean
  kind: CliErrorKind
  networkRetries: number
}): SameSessionRecoveryPlan {
  const parsed = parseHostTransportStatus(opts.raw)
  return planSameSessionRecovery({
    keepPartial: opts.keepPartial,
    processDied: opts.processDied,
    kind: opts.kind,
    attempt: parsed?.attempt ?? opts.networkRetries + 1,
    limit: parsed?.limit ?? recoveryRetryLimit(opts.kind)
  })
}

/**
 * Pick the UI phase for a same-session recovery:
 * - partial draft still on the wire → healing (continue, do not re-prompt)
 * - process died or a transport error → reconnecting
 * - stream / protocol bug → retrying
 */
export function planSameSessionRecovery(opts: {
  keepPartial: boolean
  processDied?: boolean
  kind: CliErrorKind
  attempt: number
  limit?: number
}): SameSessionRecoveryPlan {
  const limit = opts.limit ?? recoveryRetryLimit(opts.kind)
  const attempt = Math.max(1, opts.attempt)
  const keepPartial = opts.keepPartial
  let kind: TurnRecoveryKind
  if (opts.processDied || (!keepPartial && opts.kind === 'network')) kind = 'reconnecting'
  else if (keepPartial) kind = 'healing'
  else kind = 'retrying'
  return {
    phase: kind,
    prepareReplayFromBlocks: keepPartial,
    continueWithoutReprompt: keepPartial,
    recovery: { kind, attempt, limit }
  }
}

const HOST_RETRY_PROGRESS_RE =
  /(?:retrying sampling request|retrying|retry|reconnecting|reconnect)\s*(?:[:(]|\s)*(\d+)\s*\/\s*(\d+)/i

/**
 * Codex / Claude TUI strings that leak through stdio as error or system
 * events while the host is still holding the turn.
 */
export function parseHostTransportStatus(text: string): {
  kind: TurnRecoveryKind
  attempt?: number
  limit?: number
} | null {
  const raw = text.trim()
  if (!raw) return null
  const progress = HOST_RETRY_PROGRESS_RE.exec(raw)
  const attempt = progress ? Number(progress[1]) : undefined
  const limit = progress ? Number(progress[2]) : undefined
  if (/\bheal(?:ing)?\b|\brecover(?:ing|ed)?\b/i.test(raw)) {
    return { kind: 'healing', attempt, limit }
  }
  if (/\breconnect(?:ing|ed)?\b/i.test(raw)) {
    return { kind: 'reconnecting', attempt, limit }
  }
  if (/\bretry(?:ing)?\b/i.test(raw)) {
    return { kind: 'retrying', attempt, limit }
  }
  return null
}

export function shouldRetryNativeTurn(opts: {
  cancelled: boolean
  error: string | undefined
  toolCount: number
  attempts: number
  limit?: number
}): boolean {
  if (opts.cancelled || !opts.error) return false
  if (opts.toolCount > 0) return false
  const limit = opts.limit ?? NETWORK_RETRY_LIMIT
  if (opts.attempts >= limit) return false
  return shouldRetrySameSession(classifyCliError(opts.error))
}
