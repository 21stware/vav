/**
 * Parsers and redaction helpers for `request_for_secret`.
 *
 * Values must never enter tool results, transcript cards, or model context.
 * The model only sees env var names; the process env holds the secrets.
 */
import type { SecretAnswerPayload, SecretRequest } from './types.ts'

export const SECRET_REQUESTS_MAX = 20
export const ENV_NAME_MAX = 128
export const SECRET_DESCRIPTION_MAX = 2000

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const DECLINE_RE = /^(decline|deny|cancel|cancelled|canceled|拒绝|拒绝提供|取消|不同意)$/i
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi

export function isValidEnvName(name: string): boolean {
  return ENV_NAME_RE.test(name) && name.length <= ENV_NAME_MAX
}

export function normalizeEnvName(raw: unknown): string | null {
  const name = String(raw ?? '').trim()
  if (!isValidEnvName(name)) return null
  return name
}

export function normalizeSecretRequests(params: Record<string, unknown>): SecretRequest[] {
  const raw = params.secrets ?? params.items ?? params.variables ?? params.requests
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: SecretRequest[] = []
  for (const item of raw) {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const name = normalizeEnvName(row.name ?? row.variable ?? row.env ?? row.key)
    if (!name || seen.has(name)) continue
    seen.add(name)
    const description = String(row.description ?? row.hint ?? row.how ?? '')
      .trim()
      .slice(0, SECRET_DESCRIPTION_MAX)
    out.push(description ? { name, description } : { name })
    if (out.length >= SECRET_REQUESTS_MAX) break
  }
  return out
}

export function summarizeSecretRequests(requests: SecretRequest[], title?: string): string {
  const heading = title?.trim()
  if (heading) return heading
  if (requests.length === 1) return requests[0]!.name
  return requests.map((row) => row.name).join(', ')
}

export function normalizeSecretValues(
  raw: unknown,
  allowed?: ReadonlySet<string>
): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = normalizeEnvName(key)
    if (!name) continue
    if (allowed && !allowed.has(name)) continue
    if (typeof value !== 'string') continue
    const trimmed = value.replace(/\0/g, '').trim()
    if (!trimmed) continue
    out[name] = trimmed
  }
  return out
}

export function parseSecretAnswer(text: string): SecretAnswerPayload {
  const trimmed = text.trim()
  if (!trimmed || DECLINE_RE.test(trimmed)) return { declined: true }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>
      if (rec.declined === true) return { declined: true }
      const values = normalizeSecretValues(rec.values ?? rec.secrets ?? rec)
      if (Object.keys(values).length) return { declined: false, values }
    }
  } catch {
    // A raw pasted secret must not become tool output / model context.
  }
  return { declined: true }
}

export function normalizeSecretAnswerPayload(
  payload: SecretAnswerPayload | null | undefined,
  allowed: ReadonlySet<string>
): { declined: boolean; values: Record<string, string> } {
  if (!payload || payload.declined) return { declined: true, values: {} }
  const values = normalizeSecretValues(payload.values, allowed)
  if (Object.keys(values).length === 0) return { declined: true, values: {} }
  return { declined: false, values }
}

export function formatSecretToolResult(result: {
  declined: boolean
  granted: string[]
  skipped: string[]
}): string {
  if (result.declined) {
    const names = result.skipped.length ? result.skipped.join(', ') : 'requested secrets'
    return (
      `The user declined to provide session secrets (${names}). ` +
      'Do not ask them to paste secret values in chat. ' +
      'Call request_for_secret again only if they later agree.'
    )
  }
  const granted = result.granted.join(', ')
  const skipped = result.skipped.length ? ` Not provided: ${result.skipped.join(', ')}.` : ''
  const sample = result.granted[0] ?? 'NAME'
  return (
    `Session environment variables are set for this conversation only (values are hidden from you): ${granted}.` +
    `${skipped} Use $${sample} in terminal commands. ` +
    'Never echo, print, log, or write these values into files or chat.'
  )
}

export const SESSION_SECRETS_MAX = 50

export type SessionSecretNamesPayload = {
  conversationId: string
  names: string[]
}

export type SessionSecretRevealResult =
  | { ok: true; value: string }
  | { ok: false; cancelled?: boolean; error?: string }

export type SessionSecretMutateResult =
  | { ok: true; names: string[] }
  | { ok: false; error: string }

export function secretResultLooksDeclined(text: string): boolean {
  return text.includes('declined to provide session secrets')
}

export type DescriptionPart = { text: string; href?: string }

/** Split how-to text so `https://` URLs can be opened from the card. */
export function splitDescriptionParts(text: string): DescriptionPart[] {
  if (!text) return []
  const parts: DescriptionPart[] = []
  let cursor = 0
  URL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = URL_RE.exec(text))) {
    let href = match[0]
    href = href.replace(/[),.;:]+$/, '')
    const start = match.index
    const end = start + href.length
    if (start > cursor) parts.push({ text: text.slice(cursor, start) })
    parts.push({ text: href, href })
    cursor = end
    URL_RE.lastIndex = end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) })
  return parts.length ? parts : [{ text }]
}
