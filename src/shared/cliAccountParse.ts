/** How the host is authenticated — drives the empty-quota / account copy. */
export type HostAuthKind = 'oauth' | 'api-key' | 'token' | 'expired' | 'none' | 'unknown'

export type HostAccountInfo = {
  signedIn: boolean
  /** User-facing email or login label — never a raw token / UUID. */
  accountId: string | null
  /** Subscription / plan label when the CLI reports one. */
  plan: string | null
  authKind: HostAuthKind
}

export function accountInfo(
  authKind: HostAuthKind,
  extras?: { accountId?: string | null; plan?: string | null }
): HostAccountInfo {
  return {
    signedIn: authKind === 'oauth' || authKind === 'api-key' || authKind === 'token',
    accountId: extras?.accountId ?? null,
    plan: extras?.plan ?? null,
    authKind
  }
}

export function emptyAccount(): HostAccountInfo {
  return accountInfo('none')
}

/** Probe missing, failed, or not implemented — UI must not invent 未登录. */
export function unknownAccount(): HostAccountInfo {
  return accountInfo('unknown')
}

export function normalizeAuthKind(
  value: unknown,
  signedIn?: boolean
): HostAuthKind {
  if (
    value === 'oauth' ||
    value === 'api-key' ||
    value === 'token' ||
    value === 'expired' ||
    value === 'none' ||
    value === 'unknown'
  ) {
    return value
  }
  return signedIn ? 'oauth' : 'none'
}

export function asAccountRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Decode a JWT payload without verifying the signature. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2 || !parts[1]) return null
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8')
    return asAccountRecord(JSON.parse(json))
  } catch {
    return null
  }
}

export function emailFromUnknown(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.includes('@') ? trimmed : null
  }
  const rec = asAccountRecord(value)
  if (!rec) return null
  for (const key of ['email', 'userEmail', 'accountEmail', 'accountId']) {
    const found = emailFromUnknown(rec[key])
    if (found) return found
  }
  return emailFromUnknown(rec.userInfo) ?? emailFromUnknown(rec.user)
}

export function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parseCursorStatusPayload(payload: unknown): HostAccountInfo {
  const rec = asAccountRecord(payload)
  if (!rec) return emptyAccount()
  const signedIn =
    rec.isAuthenticated === true ||
    rec.status === 'authenticated' ||
    rec.hasAccessToken === true
  const accountId = emailFromUnknown(rec)
  const plan = stringField(rec.subscriptionTier) ?? stringField(rec.plan)
  if (!signedIn && !accountId) return emptyAccount()
  return accountInfo('oauth', { accountId, plan })
}

function claudeAuthKind(method: string | null): HostAuthKind {
  if (!method) return 'oauth'
  const normalized = method.toLowerCase().replace(/[_-]/g, '')
  if (normalized === 'apikey' || normalized.endsWith('apikey')) return 'api-key'
  if (normalized === 'authtoken' || normalized === 'anthropicauthtoken') return 'api-key'
  return 'oauth'
}

export function parseClaudeAuthStatusPayload(payload: unknown): HostAccountInfo {
  const rec = asAccountRecord(payload)
  if (!rec) return emptyAccount()
  if (rec.loggedIn !== true) return emptyAccount()
  return accountInfo(claudeAuthKind(stringField(rec.authMethod)), {
    accountId: emailFromUnknown(rec),
    plan: stringField(rec.apiProvider) === 'firstParty' ? null : stringField(rec.apiProvider)
  })
}

/**
 * Effective Claude auth for VAV: a settings / env token is what the CLI
 * actually sends. `claude auth status` can still report leftover OAuth.
 */
export function resolveClaudeAccount(
  settings: { token: string | null; customHost: string | null },
  cli: HostAccountInfo
): HostAccountInfo {
  if (settings.token) return accountInfo('token', { plan: settings.customHost })
  if (cli.signedIn) {
    return {
      ...cli,
      plan: cli.plan ?? settings.customHost
    }
  }
  return emptyAccount()
}

/** True only when the token is a JWT with an `exp` that has already passed. */
export function jwtIsExpired(token: string, skewSec = 120): boolean {
  const claims = decodeJwtPayload(token)
  if (!claims || typeof claims.exp !== 'number') return false
  return Date.now() / 1000 >= claims.exp - skewSec
}

export function parseCodexIdToken(idToken: string): HostAccountInfo {
  const claims = decodeJwtPayload(idToken)
  if (!claims) return emptyAccount()
  if (jwtIsExpired(idToken)) return accountInfo('expired')
  const auth = asAccountRecord(claims['https://api.openai.com/auth'])
  const plan = stringField(auth?.chatgpt_plan_type)
  const email = emailFromUnknown(claims)
  return accountInfo('oauth', { accountId: email, plan })
}

export function pickCodexApiKey(payload: unknown): string | null {
  const rec = asAccountRecord(payload)
  if (!rec) return null
  for (const key of ['OPENAI_API_KEY', 'openai_api_key', 'api_key']) {
    const value = stringField(rec[key])
    if (value) return value
  }
  return null
}

/**
 * Codex `auth.json`: ChatGPT OAuth tokens and/or `{ "OPENAI_API_KEY": "…" }`.
 * Env keys are a fallback when the file has neither a live token nor a key.
 */
export function parseCodexAuthFile(
  payload: unknown,
  envKeys: Array<string | null | undefined> = []
): HostAccountInfo {
  const rec = asAccountRecord(payload)
  const tokens = rec ? asAccountRecord(rec.tokens) : null
  const idToken = stringField(tokens?.id_token)
  const access = stringField(tokens?.access_token)
  if (idToken && !jwtIsExpired(idToken)) return parseCodexIdToken(idToken)
  if (access && !jwtIsExpired(access)) {
    return accountInfo('oauth', { accountId: emailFromUnknown(tokens) })
  }
  if (pickCodexApiKey(rec) || envKeys.some((key) => typeof key === 'string' && key.trim())) {
    return accountInfo('api-key')
  }
  if (idToken || access) return accountInfo('expired')
  return emptyAccount()
}

/** Non-official Anthropic gateway host, for the account popover plan line. */
export function hostFromAnthropicBaseUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null
  try {
    const host = new URL(url.trim()).hostname
    if (!host || host === 'api.anthropic.com' || host.endsWith('.anthropic.com')) return null
    return host
  } catch {
    return null
  }
}

/** `devin auth status` — plain text, not JSON. */
export function parseDevinAuthStatusText(text: string): HostAccountInfo {
  const raw = text.trim()
  if (!raw) return emptyAccount()
  if (/not logged in|logged out|no credentials/i.test(raw)) return emptyAccount()
  if (!/logged in/i.test(raw)) return unknownAccount()
  const email = raw.match(/^\s*Email:\s+(\S+@\S+)\s*$/im)?.[1] ?? null
  const plan =
    raw.match(/^\s*Plan:\s+(.+?)\s*$/im)?.[1]?.trim() ||
    raw.match(/^\s*Tier:\s+(.+?)\s*$/im)?.[1]?.trim() ||
    null
  return accountInfo('oauth', { accountId: email, plan: plan || null })
}

/** OpenCode `auth.json`: any stored key means signed in; email only if present. */
export function parseOpencodeAuthFile(payload: unknown): HostAccountInfo {
  const rec = asAccountRecord(payload)
  if (!rec) return emptyAccount()
  let hasKey = false
  let email = emailFromUnknown(rec)
  for (const value of Object.values(rec)) {
    const entry = asAccountRecord(value)
    if (!entry) continue
    if (typeof entry.key === 'string' && entry.key.trim()) hasKey = true
    email ??= emailFromUnknown(entry)
  }
  if (!hasKey && !email) return emptyAccount()
  return accountInfo('api-key', { accountId: email })
}

/** Claude context fill: input + cache write + cache read (t3code / Agent SDK). */
export function claudeContextUsed(usage: {
  inputTokens?: number | null
  cacheRead?: number | null
  cacheWrite?: number | null
}): number | undefined {
  const n = (usage.inputTokens ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
  return n > 0 ? n : undefined
}
