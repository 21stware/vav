import type { QuotaWindow, QuotaWindowKind } from './types'

/** Why a structured CLI host (Grok / Claude / Codex / …) failed a turn. */
export type CliErrorKind = 'quota' | 'session-stale' | 'auth' | 'cancelled' | 'generic'

/**
 * JSON-RPC 2.0 + ACP error codes.
 * @see https://www.jsonrpc.org/specification#error_object
 * @see https://agentclientprotocol.com/protocol/v1/schema
 * @see https://agentclientprotocol-typescript-sdk.mintlify.app/api/error-codes
 */
export const RpcErrorCode = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  /** Catch-all. Grok often wraps quota / backend failures here. */
  internalError: -32603,
  /** ACP: authenticate before session/new or session/load. */
  authRequired: -32000,
  /**
   * Older ACP write-ups listed this as Resource not found.
   * Current ACP TS SDK uses -32002 for that; keep both as “missing resource”.
   */
  resourceNotFoundLegacy: -32001,
  /** ACP (current): missing file / session / other resource. */
  resourceNotFound: -32002,
  /** Some ACP implementations (not in the core two-code ACP table). */
  tooManyRequests: -32006
} as const

/** Treat a window as exhausted once it reports this used %. */
export const QUOTA_EXHAUSTED_PERCENT = 99.5

const QUOTA_RE =
  /usage[_\s-]?limit|rate[_\s-]?limit|quota|credit|billing|exceeded.*limit|limit.*exceed|too many requests|\b429\b|resource[_\s-]?exhausted|insufficient[_\s-]?credits?|out of credits|plan[_\s-]?limit|spend[_\s-]?limit|usage cap|cap reached/i

const SESSION_STALE_RE =
  /session not found|unknown session|no such session|invalid session|cannot load session|failed to (?:load|resume) session|resource not found|thread not found|conversation not found|session[_\s-]?(?:expired|invalid)|not found.*session/i

const AUTH_RE =
  /authentication required|unauthori[sz]ed|\b401\b|not logged in|please (?:log|sign)\s?in|unauthenticated|auth(?:entication)? failed|invalid.?token|token.?expired/i

/** User-stop / interrupt wording from CLIs (Codex “Aborted”, ACP “Cancelled”, …). */
const CANCELLED_RE =
  /^(?:(?:request|turn|operation|the operation) )?(?:was )?(?:cancell?ed|aborted|interrupted|stopped)(?: by (?:the )?user)?\.?$/i

const BARE_INTERNAL_RE = /^(?:internal error|json-?rpc\s+internal error)(?:\s*[.:—-]\s*)?$/i

export type ExtractedRpcError = {
  code: number | null
  text: string
}

export function rpcErrorCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const raw = (error as { code?: unknown }).code
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  return null
}

const ERROR_DATA_KEYS = [
  'message',
  'data',
  'details',
  'detail',
  'error',
  'reason',
  'description',
  'type',
  'code',
  'error_description',
  'errorMessage'
] as const

export function isBareInternalError(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (BARE_INTERNAL_RE.test(trimmed)) return true
  // JSON-RPC object stringified as {"code":-32603,"message":"Internal error"}
  return /"message"\s*:\s*"internal error"/i.test(trimmed) && !QUOTA_RE.test(trimmed)
}

function pushUnique(parts: string[], value: string): void {
  const next = value.trim()
  if (!next) return
  const lower = next.toLowerCase()
  if (parts.some((part) => part.toLowerCase() === lower)) return
  parts.push(next)
}

function collectErrorParts(value: unknown, into: string[], depth = 0): void {
  if (depth > 4 || value == null) return
  if (typeof value === 'string') {
    pushUnique(into, value)
    return
  }
  if (typeof value === 'boolean') {
    pushUnique(into, String(value))
    return
  }
  if (typeof value === 'number') {
    // Skip JSON-RPC codes (-32700…-32600); keep useful numeric statuses like 429.
    if (value <= -32000) return
    pushUnique(into, String(value))
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectErrorParts(item, into, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  const rec = value as Record<string, unknown>
  for (const key of ERROR_DATA_KEYS) {
    if (key in rec) collectErrorParts(rec[key], into, depth + 1)
  }
}

/**
 * Flatten a JSON-RPC / ACP / CLI error into a single line.
 * Grok (and other ACP hosts) often put the real reason in `data` while
 * `message` is the generic "Internal error".
 */
export function extractRpcErrorText(error: unknown): string {
  return extractRpcError(error).text
}

export function extractRpcError(error: unknown): ExtractedRpcError {
  const code = rpcErrorCode(error)
  if (error == null) return { code, text: '' }
  if (typeof error === 'string') return { code, text: error.trim() }
  if (error instanceof Error) return { code, text: error.message.trim() }
  if (typeof error !== 'object') return { code, text: String(error) }

  const rec = error as Record<string, unknown>
  const parts: string[] = []
  collectErrorParts(rec, parts)

  const message = typeof rec.message === 'string' ? rec.message.trim() : ''
  const dataParts = parts.filter((part) => part !== message)
  let text = ''
  if (message && isBareInternalError(message) && dataParts.length) {
    text = dataParts.join(' — ')
  } else if (message && dataParts.length) {
    const extra = dataParts.filter((part) => !message.includes(part)).join(' — ')
    text = extra ? `${message} — ${extra}` : message
  } else if (parts.length) {
    text = parts.join(' — ')
  } else {
    try {
      text = JSON.stringify(rec)
    } catch {
      text = 'Internal error'
    }
  }
  return { code, text }
}

/**
 * Full payload for the “details” sheet: official code, protocol message, and
 * the raw JSON-RPC object when we still have it.
 */
export function formatErrorDetail(error: unknown, fallbackText?: string): string {
  const extracted = extractRpcError(error)
  const lines: string[] = []
  if (extracted.code != null) lines.push(`code ${extracted.code}`)
  if (error instanceof Error) {
    const stack = error.stack?.trim()
    lines.push(stack || error.message)
    return lines.join('\n')
  }
  if (error && typeof error === 'object') {
    const rec = error as Record<string, unknown>
    const message = typeof rec.message === 'string' ? rec.message.trim() : ''
    if (message) lines.push(message)
    if (extracted.text && extracted.text !== message) lines.push(extracted.text)
    try {
      lines.push(JSON.stringify(error, null, 2))
    } catch {
      /* ignore */
    }
    return lines.join('\n').trim()
  }
  const text = extracted.text || fallbackText?.trim() || ''
  if (text && !lines.includes(text)) lines.push(text)
  return lines.join('\n').trim()
}

export function formatErrorDetailFromParts(text: string, code?: number | null): string {
  return formatErrorDetail(
    code != null ? { code, message: text } : text,
    text
  )
}

export function exhaustedQuotaWindows(windows: QuotaWindow[] | null | undefined): QuotaWindow[] {
  if (!windows?.length) return []
  return windows.filter((window) => window.usedPercent >= QUOTA_EXHAUSTED_PERCENT)
}

/** Prefer the soonest reset among exhausted windows. */
export function pickExhaustedQuotaWindow(
  windows: QuotaWindow[] | null | undefined
): QuotaWindow | null {
  const exhausted = exhaustedQuotaWindows(windows)
  if (!exhausted.length) return null
  return [...exhausted].sort((a, b) => {
    if (a.resetsAt != null && b.resetsAt != null) return a.resetsAt - b.resetsAt
    if (a.resetsAt != null) return -1
    if (b.resetsAt != null) return 1
    return b.usedPercent - a.usedPercent
  })[0]!
}

export function classifyCliError(
  text: string,
  windows?: QuotaWindow[] | null,
  code?: number | null
): CliErrorKind {
  const raw = text.trim()
  if (CANCELLED_RE.test(raw)) return 'cancelled'
  // Official codes first — message text is a fallback for Claude/Codex/stderr.
  if (code === RpcErrorCode.authRequired) return 'auth'
  if (code === RpcErrorCode.resourceNotFound || code === RpcErrorCode.resourceNotFoundLegacy) {
    return 'session-stale'
  }
  if (code === RpcErrorCode.tooManyRequests || code === 429) return 'quota'
  if (QUOTA_RE.test(raw)) return 'quota'
  if (SESSION_STALE_RE.test(raw)) return 'session-stale'
  if (AUTH_RE.test(raw)) return 'auth'
  if (
    (code === RpcErrorCode.internalError || isBareInternalError(raw)) &&
    pickExhaustedQuotaWindow(windows)
  ) {
    return 'quota'
  }
  return 'generic'
}

export function quotaKindMessageKey(kind: QuotaWindowKind):
  | 'token.quotaFiveHour'
  | 'token.quotaWeekly'
  | 'token.quotaWeeklyOpus'
  | 'token.quotaWeeklySonnet'
  | 'token.quotaMonthly'
  | 'token.quotaPrimary'
  | 'token.quotaSecondary'
  | 'token.quotaOther' {
  switch (kind) {
    case 'five_hour':
      return 'token.quotaFiveHour'
    case 'seven_day':
      return 'token.quotaWeekly'
    case 'seven_day_opus':
      return 'token.quotaWeeklyOpus'
    case 'seven_day_sonnet':
      return 'token.quotaWeeklySonnet'
    case 'monthly':
      return 'token.quotaMonthly'
    case 'primary':
      return 'token.quotaPrimary'
    case 'secondary':
      return 'token.quotaSecondary'
    default:
      return 'token.quotaOther'
  }
}

/**
 * After a resume cursor failed, decide whether to drop it and start a new
 * native session (login switch, deleted thread, other-account session).
 * Never retry quota — a fresh session hits the same cap.
 */
export function shouldRetryFreshSession(
  kind: CliErrorKind,
  raw: string,
  hadResumeCursor: boolean,
  code?: number | null
): boolean {
  if (!hadResumeCursor) return false
  if (kind === 'quota' || kind === 'auth' || kind === 'cancelled') return false
  if (
    kind === 'session-stale' ||
    code === RpcErrorCode.resourceNotFound ||
    code === RpcErrorCode.resourceNotFoundLegacy
  ) {
    return true
  }
  return code === RpcErrorCode.internalError || isBareInternalError(raw)
}
