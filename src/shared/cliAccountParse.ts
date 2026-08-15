export type HostAccountInfo = {
  signedIn: boolean
  /** User-facing email or login label — never a raw token / UUID. */
  accountId: string | null
  /** Subscription / plan label when the CLI reports one. */
  plan: string | null
}

export function emptyAccount(): HostAccountInfo {
  return { signedIn: false, accountId: null, plan: null }
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
  return { signedIn: signedIn || !!accountId, accountId, plan }
}

export function parseClaudeAuthStatusPayload(payload: unknown): HostAccountInfo {
  const rec = asAccountRecord(payload)
  if (!rec) return emptyAccount()
  const signedIn = rec.loggedIn === true
  return {
    signedIn,
    accountId: emailFromUnknown(rec),
    plan: stringField(rec.apiProvider) === 'firstParty' ? null : stringField(rec.apiProvider)
  }
}

export function parseCodexIdToken(idToken: string): HostAccountInfo {
  const claims = decodeJwtPayload(idToken)
  if (!claims) return emptyAccount()
  const auth = asAccountRecord(claims['https://api.openai.com/auth'])
  const plan = stringField(auth?.chatgpt_plan_type)
  const email = emailFromUnknown(claims)
  return { signedIn: true, accountId: email, plan }
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
  return { signedIn: true, accountId: email, plan: null }
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
