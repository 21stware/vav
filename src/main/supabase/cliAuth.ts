/**
 * Reuse a machine-local `supabase login` the same way GitHub uses `gh`
 * and Cloudflare uses Wrangler.
 *
 * Order after a vav-stored token / SUPABASE_ACCESS_TOKEN:
 * 1. `~/.supabase/access-token` (CLI fallback when keyring is unavailable)
 * 2. macOS Keychain item "Supabase CLI" / account "supabase"
 * 3. `supabase` CLI itself (`projects list` / `functions list`) which already
 *    knows how to read the keyring — no extra Access Token paste.
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { looksLikeSupabaseAccessToken, supabaseAccessTokenFileCandidates } from '@shared/supabaseAuth'
import { loginPath, resolveOnLoginPath } from '../terminal/loginPath'

const execFileAsync = promisify(execFile)
const CLI_TIMEOUT_MS = 15_000
const CACHE_MS = 60_000
const KEYCHAIN_SERVICE = 'Supabase CLI'
const KEYCHAIN_ACCOUNTS = ['supabase', 'Supabase CLI']

export type SupabaseTokenSource = 'settings' | 'env' | 'cli' | null

type Resolved = { token: string | null; source: SupabaseTokenSource }

let cache: { at: number; value: Resolved } | null = null

function envApiToken(): string | null {
  const token = (process.env.SUPABASE_ACCESS_TOKEN || '').trim()
  return token && looksLikeSupabaseAccessToken(token) ? token : null
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export function findSupabaseAccessTokenFile(): { path: string; token: string } | null {
  for (const path of supabaseAccessTokenFileCandidates(homedir(), process.env)) {
    if (!existsSync(path)) continue
    const token = (readText(path) ?? '').trim()
    if (!looksLikeSupabaseAccessToken(token)) continue
    return { path, token }
  }
  return null
}

function keychainFind(account: string | null, secret: boolean): Promise<string | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null)
  const args = ['find-generic-password', '-s', KEYCHAIN_SERVICE]
  if (account) args.push('-a', account)
  if (secret) args.push('-w')
  return execFileAsync('security', args, {
    timeout: 5_000,
    maxBuffer: 16 * 1024
  })
    .then(({ stdout }) => {
      const value = stdout.toString().trim()
      if (!secret) return value || 'ok'
      return looksLikeSupabaseAccessToken(value) ? value : null
    })
    .catch(() => null)
}

async function keychainTokenPresent(): Promise<boolean> {
  for (const account of KEYCHAIN_ACCOUNTS) {
    if (await keychainFind(account, false)) return true
  }
  return (await keychainFind(null, false)) != null
}

async function tokenFromKeychain(): Promise<string | null> {
  for (const account of KEYCHAIN_ACCOUNTS) {
    const token = await keychainFind(account, true)
    if (token) return token
  }
  return keychainFind(null, true)
}

export function supabaseBin(): string | null {
  return resolveOnLoginPath('supabase')
}

export async function supabaseCliJson(
  args: string[],
  cwd?: string
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const bin = supabaseBin()
  if (!bin) return { ok: false, error: 'supabase CLI not found' }
  try {
    const { stdout, stderr } = await execFileAsync(bin, [...args, '--agent', 'no', '-o', 'json'], {
      timeout: CLI_TIMEOUT_MS,
      cwd: cwd || undefined,
      env: { ...process.env, PATH: loginPath() },
      maxBuffer: 2 * 1024 * 1024
    })
    const text = stdout.toString().trim()
    if (!text) {
      return { ok: false, error: stderr.toString().trim() || 'supabase CLI returned no JSON' }
    }
    try {
      return { ok: true, data: JSON.parse(text) }
    } catch {
      return { ok: false, error: 'supabase CLI returned invalid JSON' }
    }
  } catch (err) {
    const e = err as { stderr?: string | Buffer; message?: string }
    const stderr = e.stderr ? e.stderr.toString().trim() : ''
    return { ok: false, error: stderr || e.message || 'supabase CLI failed' }
  }
}

/**
 * Resolve a Management API token.
 * Settings → env → access-token file → macOS Keychain (`supabase login`).
 */
export async function resolveSupabaseToken(stored: string | null): Promise<Resolved> {
  const fromStore = stored?.trim() || null
  if (fromStore) return { token: fromStore, source: 'settings' }
  const fromEnv = envApiToken()
  if (fromEnv) return { token: fromEnv, source: 'env' }

  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value

  const fromFile = findSupabaseAccessTokenFile()
  if (fromFile) {
    const value: Resolved = { token: fromFile.token, source: 'cli' }
    cache = { at: Date.now(), value }
    return value
  }
  const fromKeychain = await tokenFromKeychain()
  const value: Resolved = {
    token: fromKeychain,
    source: fromKeychain ? 'cli' : null
  }
  cache = { at: Date.now(), value }
  return value
}

/** Local-only: do not spawn `supabase` or unlock Keychain secrets. */
export async function peekSupabaseAuth(stored: string | null): Promise<{
  present: boolean
  source: SupabaseTokenSource
}> {
  const fromStore = stored?.trim() || null
  if (fromStore) return { present: true, source: 'settings' }
  if (envApiToken()) return { present: true, source: 'env' }
  if (findSupabaseAccessTokenFile()) return { present: true, source: 'cli' }
  if (await keychainTokenPresent()) return { present: true, source: 'cli' }
  return { present: false, source: null }
}
