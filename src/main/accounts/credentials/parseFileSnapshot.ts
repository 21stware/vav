import {
  asAccountRecord,
  decodeJwtPayload,
  parseCodexAuthFile,
  parseOpencodeAuthFile
} from '../../../shared/cliAccountParse.ts'

const PREFERRED_GROK_ISSUER = 'https://auth.x.ai'

export function parseFileSnapshotMeta(
  host: string,
  raw: string
): { identity: string | null; expiresAtMs: number | null } {
  if (host === 'grok') return parseGrokMeta(raw)
  if (host === 'codex') return parseCodexMeta(raw)
  if (host === 'opencode') return parseOpencodeMeta(raw)
  if (host === 'pi') return { identity: null, expiresAtMs: null }
  return { identity: null, expiresAtMs: null }
}

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function parseExpiresAtMs(iso: unknown): number | null {
  if (typeof iso !== 'string' || !iso.trim()) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

function jwtExpiresAtMs(token: string): number | null {
  const claims = decodeJwtPayload(token)
  if (!claims || typeof claims.exp !== 'number') return null
  return claims.exp * 1000
}

function isPreferredGrokIssuer(key: string): boolean {
  return key === PREFERRED_GROK_ISSUER || key.startsWith(`${PREFERRED_GROK_ISSUER}::`)
}

function parseGrokMeta(raw: string): { identity: string | null; expiresAtMs: number | null } {
  const parsed = parseJson(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { identity: null, expiresAtMs: null }
  }
  let preferred: { identity: string | null; expiresAtMs: number | null } | null = null
  let fallback: { identity: string | null; expiresAtMs: number | null } | null = null
  for (const [issuer, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = asAccountRecord(value)
    if (!entry) continue
    const email = typeof entry.email === 'string' && entry.email.includes('@') ? entry.email.trim() : null
    const meta = { identity: email, expiresAtMs: parseExpiresAtMs(entry.expires_at) }
    if (isPreferredGrokIssuer(issuer)) {
      preferred ??= meta
      continue
    }
    fallback ??= meta
  }
  return preferred ?? fallback ?? { identity: null, expiresAtMs: null }
}

function parseCodexMeta(raw: string): { identity: string | null; expiresAtMs: number | null } {
  const parsed = parseJson(raw)
  const info = parseCodexAuthFile(parsed)
  const tokens = asAccountRecord(asAccountRecord(parsed)?.tokens)
  const idToken = typeof tokens?.id_token === 'string' ? tokens.id_token : null
  const access = typeof tokens?.access_token === 'string' ? tokens.access_token : null
  return {
    identity: info.accountId,
    expiresAtMs: (idToken && jwtExpiresAtMs(idToken)) || (access && jwtExpiresAtMs(access)) || null
  }
}

function parseOpencodeMeta(raw: string): { identity: string | null; expiresAtMs: number | null } {
  const parsed = parseJson(raw)
  return { identity: parseOpencodeAuthFile(parsed).accountId, expiresAtMs: null }
}
