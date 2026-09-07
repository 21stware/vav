/**
 * Locations the official Vercel CLI writes after `vercel login`.
 * Pure parse / path helpers — the main process reads the file and refreshes.
 */

import { join } from 'node:path'

export type VercelCliAuthFile = {
  token: string | null
  refreshToken: string | null
  expiresAt: number | null
}

export function parseVercelAuthJson(source: string): VercelCliAuthFile {
  try {
    const raw = JSON.parse(source) as {
      token?: unknown
      refreshToken?: unknown
      expiresAt?: unknown
    }
    if (!raw || typeof raw !== 'object') {
      return { token: null, refreshToken: null, expiresAt: null }
    }
    const token = typeof raw.token === 'string' && raw.token.trim() ? raw.token.trim() : null
    const refreshToken =
      typeof raw.refreshToken === 'string' && raw.refreshToken.trim() ? raw.refreshToken.trim() : null
    const expiresAt =
      typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt) ? raw.expiresAt : null
    return { token, refreshToken, expiresAt }
  } catch {
    return { token: null, refreshToken: null, expiresAt: null }
  }
}

export function vercelAuthHasToken(auth: VercelCliAuthFile): boolean {
  return Boolean(auth.token)
}

/** Refresh a minute early so a request does not race the expiry. */
export function vercelCliTokenExpired(expiresAt: number | null, nowMs = Date.now()): boolean {
  if (expiresAt == null) return false
  return nowMs >= expiresAt * 1000 - 60_000
}

/**
 * Candidate `auth.json` paths, matching Vercel CLI (XDG + Application Support + legacy).
 * First existing file wins at read time.
 */
export function vercelAuthFileCandidates(
  home: string,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform
): string[] {
  const files: string[] = []
  const seen = new Set<string>()
  const push = (path: string): void => {
    const trimmed = path.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    files.push(trimmed)
  }

  const xdg = env.XDG_DATA_HOME || join(home, '.local', 'share')
  if (platform === 'darwin') {
    push(join(home, 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'))
    push(join(xdg, 'com.vercel.cli', 'auth.json'))
  } else if (platform === 'win32') {
    const appdata = env.APPDATA || join(home, 'AppData', 'Roaming')
    push(join(appdata, 'com.vercel.cli', 'auth.json'))
    push(join(appdata, 'xdg.data', 'com.vercel.cli', 'auth.json'))
    push(join(xdg, 'com.vercel.cli', 'auth.json'))
  } else {
    push(join(xdg, 'com.vercel.cli', 'auth.json'))
  }
  push(join(home, '.vercel', 'auth.json'))
  push(join(home, '.now', 'auth.json'))
  return files
}

export function applyVercelAuthRefresh(
  source: string,
  next: { token: string; refreshToken?: string | null; expiresAt: number }
): string {
  let parsed: Record<string, unknown> = {}
  try {
    const raw = JSON.parse(source) as unknown
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      parsed = { ...(raw as Record<string, unknown>) }
    }
  } catch {
    // Replace a corrupt file with a minimal session.
  }
  parsed.token = next.token
  parsed.expiresAt = next.expiresAt
  if (next.refreshToken) parsed.refreshToken = next.refreshToken
  return `${JSON.stringify(parsed, null, 2)}\n`
}
