/**
 * Reuse a machine-local `vercel login` the same way GitHub uses `gh`
 * and Cloudflare uses Wrangler.
 *
 * Order after a vav-stored token / VERCEL_TOKEN:
 * 1. `auth.json` from Vercel CLI (refresh OAuth if expired)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  applyVercelAuthRefresh,
  parseVercelAuthJson,
  vercelAuthFileCandidates,
  vercelAuthHasToken,
  vercelCliTokenExpired,
  type VercelCliAuthFile
} from '@shared/vercelAuth'
import type { VercelTokenSource } from '@shared/vercel'

/** Public Vercel CLI client — used only to refresh an existing `vercel login`. */
const VERCEL_CLI_CLIENT_ID = 'cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp'
const TOKEN_URL = 'https://api.vercel.com/login/oauth/token'
const REFRESH_TIMEOUT_MS = 15_000
const CACHE_MS = 60_000

export type ResolvedVercelAuth = { token: string | null; source: VercelTokenSource }

type Resolved = ResolvedVercelAuth

let cache: { at: number; value: Resolved } | null = null

function envApiToken(): string | null {
  const token = (process.env.VERCEL_TOKEN || '').trim()
  return token || null
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export function findVercelAuthFile(): { path: string; text: string; parsed: VercelCliAuthFile } | null {
  const files = vercelAuthFileCandidates(homedir(), process.env, process.platform)
  for (const path of files) {
    if (!existsSync(path)) continue
    const text = readText(path)
    if (text == null) continue
    const parsed = parseVercelAuthJson(text)
    if (!vercelAuthHasToken(parsed)) continue
    return { path, text, parsed }
  }
  return null
}

/** Cheap: a Vercel login file exists (no refresh, no network). */
export function vercelLoginPresent(): boolean {
  return findVercelAuthFile() != null
}

async function refreshOauth(refreshToken: string): Promise<{
  token: string
  refreshToken: string | null
  expiresAt: number
} | null> {
  const body = new URLSearchParams({
    client_id: VERCEL_CLI_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
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
      token: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function writeRefreshed(
  path: string,
  source: string,
  next: { token: string; refreshToken: string | null; expiresAt: number }
): void {
  try {
    writeFileSync(path, applyVercelAuthRefresh(source, next), 'utf8')
  } catch {
    // In-memory token still works this session.
  }
}

async function tokenFromVercelFile(): Promise<string | null> {
  const found = findVercelAuthFile()
  if (!found) return null
  const { path, text, parsed } = found
  if (!parsed.token) return null
  if (!vercelCliTokenExpired(parsed.expiresAt)) return parsed.token
  if (!parsed.refreshToken) return parsed.token
  const next = await refreshOauth(parsed.refreshToken)
  if (!next) return parsed.token
  writeRefreshed(path, text, next)
  return next.token
}

/**
 * Resolve a Vercel API / OAuth token.
 * Settings (explicit) → env → Vercel CLI login file.
 */
export async function resolveVercelToken(stored: string | null): Promise<Resolved> {
  const fromStore = stored?.trim() || null
  if (fromStore) return { token: fromStore, source: 'settings' }
  const fromEnv = envApiToken()
  if (fromEnv) return { token: fromEnv, source: 'env' }

  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value

  const fromFile = await tokenFromVercelFile()
  const value: Resolved = {
    token: fromFile,
    source: fromFile ? 'cli' : null
  }
  cache = { at: Date.now(), value }
  return value
}

/** Local-only: do not refresh OAuth. */
export function peekVercelAuth(stored: string | null): {
  present: boolean
  source: VercelTokenSource
} {
  const fromStore = stored?.trim() || null
  if (fromStore) return { present: true, source: 'settings' }
  if (envApiToken()) return { present: true, source: 'env' }
  if (vercelLoginPresent()) return { present: true, source: 'cli' }
  return { present: false, source: null }
}

export function clearVercelAuthCache(): void {
  cache = null
}
