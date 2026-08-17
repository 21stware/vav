/**
 * Reuse a machine-local Wrangler login the same way GitHub uses `gh auth token`.
 *
 * Order after a vav-stored token / CLOUDFLARE_API_TOKEN:
 * 1. `wrangler auth token` (Wrangler 4+; refreshes OAuth and handles keyring)
 * 2. `default.toml` from Wrangler 3 (`oauth_token`, refresh if expired)
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import {
  applyWranglerAuthRefresh,
  parseWranglerAuthToml,
  wranglerAuthFileCandidates,
  wranglerAuthHasToken,
  wranglerOauthExpired,
  type WranglerAuthFile
} from '@shared/wranglerAuth'
import { loginPath, resolveOnLoginPath } from '../terminal/loginPath'

const execFileAsync = promisify(execFile)
const CLI_TIMEOUT_MS = 10_000
const REFRESH_TIMEOUT_MS = 15_000
const CACHE_MS = 60_000
const WRANGLER_OAUTH_CLIENT_ID = '54d11594-84e4-41aa-b438-e81b8fa78ee7'
const TOKEN_URL = 'https://dash.cloudflare.com/oauth2/token'

export type CloudflareTokenSource = 'settings' | 'env' | 'wrangler' | null

type Resolved = { token: string | null; source: CloudflareTokenSource }

let cache: { at: number; value: Resolved } | null = null

function envApiToken(): string | null {
  const token = (process.env.CLOUDFLARE_API_TOKEN || '').trim()
  return token || null
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export function findWranglerAuthFile(): { path: string; text: string; parsed: WranglerAuthFile } | null {
  const files = wranglerAuthFileCandidates(homedir(), process.env, process.platform)
  for (const path of files) {
    if (!existsSync(path)) continue
    const text = readText(path)
    if (text == null) continue
    const parsed = parseWranglerAuthToml(text)
    if (!wranglerAuthHasToken(parsed)) continue
    return { path, text, parsed }
  }
  return null
}

/** Cheap: a Wrangler login file exists (no refresh, no network). */
export function wranglerLoginPresent(): boolean {
  return findWranglerAuthFile() != null
}

async function wranglerCliToken(): Promise<string | null> {
  const bin = resolveOnLoginPath('wrangler')
  if (!bin) return null
  try {
    const { stdout } = await execFileAsync(bin, ['auth', 'token'], {
      timeout: CLI_TIMEOUT_MS,
      env: { ...process.env, PATH: loginPath() },
      maxBuffer: 64 * 1024
    })
    const lines = stdout
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    // Banner / warnings first; the token is the last non-empty line.
    const token = lines.at(-1) ?? ''
    if (!token || /\s/.test(token) || token.length < 20) return null
    if (/error|not logged|unknown command|usage:/i.test(token)) return null
    return token
  } catch {
    return null
  }
}

async function refreshOauth(refreshToken: string): Promise<{
  oauthToken: string
  refreshToken: string | null
  expirationTime: string
} | null> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: WRANGLER_OAUTH_CLIENT_ID
  })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REFRESH_TIMEOUT_MS)
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: ctrl.signal
    })
    const json = (await res.json().catch(() => null)) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      error?: string
    } | null
    if (!res.ok || !json?.access_token) return null
    const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600
    return {
      oauthToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expirationTime: new Date(Date.now() + expiresIn * 1000).toISOString()
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function writeRefreshed(path: string, source: string, next: {
  oauthToken: string
  refreshToken: string | null
  expirationTime: string
}): void {
  try {
    writeFileSync(path, applyWranglerAuthRefresh(source, next), 'utf8')
  } catch {
    // In-memory token still works this session.
  }
}

async function tokenFromWranglerFile(): Promise<string | null> {
  const found = findWranglerAuthFile()
  if (!found) return null
  const { path, text, parsed } = found
  if (parsed.apiToken) return parsed.apiToken
  if (!parsed.oauthToken) return null
  if (!wranglerOauthExpired(parsed.expirationTime)) return parsed.oauthToken
  if (!parsed.refreshToken) return parsed.oauthToken
  const next = await refreshOauth(parsed.refreshToken)
  if (!next) return parsed.oauthToken
  writeRefreshed(path, text, next)
  return next.oauthToken
}

/**
 * Resolve a Cloudflare API / OAuth token.
 * Settings (explicit) → env → Wrangler CLI → Wrangler login file.
 */
export async function resolveCloudflareToken(stored: string | null): Promise<Resolved> {
  const fromStore = stored?.trim() || null
  if (fromStore) return { token: fromStore, source: 'settings' }
  const fromEnv = envApiToken()
  if (fromEnv) return { token: fromEnv, source: 'env' }

  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value

  // Prefer the login file (Wrangler 3). `wrangler auth token` is Wrangler 4+
  // and on v3 just prints help with exit 0.
  const fromFile = await tokenFromWranglerFile()
  if (fromFile) {
    const value: Resolved = { token: fromFile, source: 'wrangler' }
    cache = { at: Date.now(), value }
    return value
  }
  const fromCli = await wranglerCliToken()
  const value: Resolved = {
    token: fromCli,
    source: fromCli ? 'wrangler' : null
  }
  cache = { at: Date.now(), value }
  return value
}

/** Local-only: do not spawn wrangler or refresh OAuth. */
export function peekCloudflareAuth(stored: string | null): {
  present: boolean
  source: CloudflareTokenSource
} {
  const fromStore = stored?.trim() || null
  if (fromStore) return { present: true, source: 'settings' }
  if (envApiToken()) return { present: true, source: 'env' }
  if (wranglerLoginPresent()) return { present: true, source: 'wrangler' }
  return { present: false, source: null }
}
