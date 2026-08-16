import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { net } from 'electron'
import { accountInfo, emptyAccount, type HostAccountInfo } from '@shared/cliAccountParse'
import { windowsFromGrokBillingPayload } from '@shared/quotaWindows'
import type { QuotaWindow } from '@shared/types'

const GROK_CLI_PROXY_BASE =
  process.env.GROK_CLI_CHAT_PROXY_BASE_URL?.trim().replace(/\/$/, '') ||
  'https://cli-chat-proxy.grok.com/v1'
const BILLING_CREDITS_URL = `${GROK_CLI_PROXY_BASE}/billing?format=credits`
const BILLING_DEFAULT_URL = `${GROK_CLI_PROXY_BASE}/billing`
const API_TIMEOUT_MS = 10_000
const GROK_CLI_AUTH_HEADER = 'xai-grok-cli'
const TOKEN_SKEW_MS = 5 * 60_000
const PREFERRED_ISSUER = 'https://auth.x.ai'

type GrokAuthSession = {
  accessToken: string
  userId: string | null
  email: string | null
  expiresAtMs: number | null
}

function grokHome(): string {
  return process.env.GROK_HOME?.trim() || join(homedir(), '.grok')
}

function parseExpiresAtMs(iso: unknown): number | null {
  if (typeof iso !== 'string' || !iso.trim()) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

function isFresh(session: GrokAuthSession): boolean {
  if (session.expiresAtMs == null) return true
  return session.expiresAtMs - Date.now() > TOKEN_SKEW_MS
}

function isPreferredIssuer(key: string): boolean {
  return key === PREFERRED_ISSUER || key.startsWith(`${PREFERRED_ISSUER}::`)
}

function sessionFromEntry(entry: Record<string, unknown>): GrokAuthSession | null {
  const key = entry.key
  if (typeof key !== 'string' || !key) return null
  const email = typeof entry.email === 'string' ? entry.email.trim() : ''
  return {
    accessToken: key,
    userId: typeof entry.user_id === 'string' ? entry.user_id : null,
    email: email.includes('@') ? email : null,
    expiresAtMs: parseExpiresAtMs(entry.expires_at)
  }
}

function readGrokAuthSession(): GrokAuthSession | null {
  const path = join(grokHome(), 'auth.json')
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    let preferredKeySeen = false
    let expiredPreferred: GrokAuthSession | null = null
    let fallback: GrokAuthSession | null = null
    for (const [issuer, value] of Object.entries(parsed as Record<string, unknown>)) {
      const preferred = isPreferredIssuer(issuer)
      preferredKeySeen ||= preferred
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const session = sessionFromEntry(value as Record<string, unknown>)
      if (!session) continue
      if (preferred) {
        if (isFresh(session)) return session
        expiredPreferred ??= session
        continue
      }
      fallback ??= session
    }
    return expiredPreferred ?? (preferredKeySeen ? null : fallback)
  } catch {
    return null
  }
}

/** Current Grok CLI account id (user id, else a token fingerprint). */
export function readGrokAuthIdentity(): string | null {
  const session = readGrokAuthSession()
  if (!session) return null
  if (session.userId) return `user:${session.userId}`
  return `tok:${createHash('sha256').update(session.accessToken).digest('hex').slice(0, 16)}`
}

/** Login state + email for the account popover (never the user UUID). */
export function readGrokAccountInfo(): HostAccountInfo {
  const session = readGrokAuthSession()
  if (!session) return emptyAccount()
  if (!isFresh(session)) return accountInfo('expired', { accountId: session.email })
  return accountInfo('oauth', { accountId: session.email })
}

function grokHeaders(session: GrokAuthSession): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.accessToken}`,
    'X-XAI-Token-Auth': GROK_CLI_AUTH_HEADER,
    Accept: 'application/json'
  }
  if (session.userId) headers['x-userid'] = session.userId
  return headers
}

async function fetchBillingJson(
  url: string,
  session: GrokAuthSession
): Promise<unknown | null> {
  const res = await net.fetch(url, {
    headers: grokHeaders(session),
    signal: AbortSignal.timeout(API_TIMEOUT_MS)
  })
  if (!res.ok) return null
  return res.json()
}

export async function fetchGrokAccountQuota(): Promise<QuotaWindow[]> {
  const session = readGrokAuthSession()
  if (!session || !isFresh(session)) return []
  const credits = await fetchBillingJson(BILLING_CREDITS_URL, session)
  if (credits == null) return []
  const fromCredits = windowsFromGrokBillingPayload(credits)
  if (fromCredits.some((w) => w.kind === 'seven_day')) return fromCredits
  const monthlyView = await fetchBillingJson(BILLING_DEFAULT_URL, session)
  if (monthlyView == null) return fromCredits
  const fromMonthly = windowsFromGrokBillingPayload(monthlyView)
  return fromMonthly.length ? fromMonthly : fromCredits
}
