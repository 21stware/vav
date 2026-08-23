import { decodeJwtPayload, emailFromUnknown } from '../../../shared/cliAccountParse.ts'
import type { HostCredentialSnapshot } from './adapter.ts'

export function parseCursorKeychainMeta(payload: string): {
  identity: string | null
  expiresAtMs: number | null
} {
  const claims = decodeJwtPayload(payload.trim())
  if (!claims) return { identity: null, expiresAtMs: null }
  const exp = typeof claims.exp === 'number' && Number.isFinite(claims.exp) ? claims.exp * 1000 : null
  return { identity: emailFromUnknown(claims), expiresAtMs: exp }
}

export function parseClaudeKeychainMeta(payload: string): {
  identity: string | null
  expiresAtMs: number | null
} {
  try {
    const parsed = JSON.parse(payload) as { claudeAiOauth?: Record<string, unknown> }
    const oauth = parsed?.claudeAiOauth
    if (!oauth || typeof oauth !== 'object') return { identity: null, expiresAtMs: null }
    const email =
      emailFromUnknown(oauth) ??
      (typeof oauth.account === 'object' ? emailFromUnknown(oauth.account) : null)
    const expiresAtMs =
      typeof oauth.expiresAt === 'number'
        ? oauth.expiresAt
        : typeof oauth.expires_at === 'number'
          ? oauth.expires_at
          : null
    return { identity: email, expiresAtMs }
  } catch {
    return { identity: null, expiresAtMs: null }
  }
}

/** Bearer token hidden in a host snapshot, if we know how to unwrap it. */
export function accessTokenFromSnapshot(
  host: string,
  snapshot: HostCredentialSnapshot | null | undefined
): string | undefined {
  const raw = snapshot?.payload?.trim()
  if (!raw) return undefined
  if (host === 'cursor') return raw
  if (host === 'claude') {
    try {
      const parsed = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: unknown } }
      const token = parsed?.claudeAiOauth?.accessToken
      return typeof token === 'string' && token.trim() ? token.trim() : undefined
    } catch {
      return raw.includes('.') ? raw : undefined
    }
  }
  if (host === 'grok' || host === 'opencode') {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const preferred =
        host === 'opencode' ? ['opencode-go', 'opencode', 'zen'] : ['https://auth.x.ai']
      for (const id of preferred) {
        const entry = parsed[id]
        const key = entry && typeof entry === 'object' ? (entry as { key?: unknown }).key : null
        if (typeof key === 'string' && key.trim()) return key.trim()
      }
      for (const value of Object.values(parsed)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const key = (value as { key?: unknown }).key
        if (typeof key === 'string' && key.trim()) return key.trim()
      }
    } catch {
      return undefined
    }
  }
  if (host === 'codex') {
    try {
      const parsed = JSON.parse(raw) as { tokens?: { access_token?: unknown } }
      const token = parsed.tokens?.access_token
      return typeof token === 'string' && token.trim() ? token.trim() : undefined
    } catch {
      return undefined
    }
  }
  return undefined
}
