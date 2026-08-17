/**
 * Wrangler login files (oauth_token from `wrangler login`). Pure parse / path
 * helpers — the main process reads the file and refreshes if needed.
 */

import { join } from 'node:path'

export type WranglerAuthFile = {
  oauthToken: string | null
  refreshToken: string | null
  expirationTime: string | null
  apiToken: string | null
}

function unquote(raw: string): string {
  const t = raw.trim()
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1)
  }
  return t
}

function tomlTopString(source: string, key: string): string | null {
  const re = new RegExp(`^${key}\\s*=\\s*(.+)$`, 'im')
  const m = re.exec(source)
  if (!m) return null
  return unquote(m[1]!) || null
}

export function parseWranglerAuthToml(source: string): WranglerAuthFile {
  return {
    oauthToken: tomlTopString(source, 'oauth_token'),
    refreshToken: tomlTopString(source, 'refresh_token'),
    expirationTime: tomlTopString(source, 'expiration_time'),
    apiToken: tomlTopString(source, 'api_token')
  }
}

export function wranglerAuthHasToken(auth: WranglerAuthFile): boolean {
  return Boolean(auth.oauthToken || auth.apiToken)
}

/** Refresh a minute early so a request does not race the expiry. */
export function wranglerOauthExpired(expirationTime: string | null, now = Date.now()): boolean {
  if (!expirationTime) return false
  const at = Date.parse(expirationTime)
  if (!Number.isFinite(at)) return false
  return now >= at - 60_000
}

/**
 * Candidate `default.toml` paths, matching Wrangler 3/4 (env-paths + legacy).
 * First existing file wins at read time.
 */
export function wranglerAuthFileCandidates(
  home: string,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform
): string[] {
  const dirs: string[] = []
  const pushDir = (dir: string): void => {
    const trimmed = dir.trim()
    if (trimmed) dirs.push(trimmed)
  }
  if (env.WRANGLER_HOME) pushDir(env.WRANGLER_HOME)
  if (platform === 'darwin') {
    pushDir(join(home, 'Library', 'Preferences', '.wrangler'))
  } else if (platform === 'win32') {
    const appdata = env.APPDATA || join(home, 'AppData', 'Roaming')
    pushDir(join(appdata, '.wrangler'))
    pushDir(join(appdata, '.wrangler', 'Config'))
  } else {
    pushDir(join(env.XDG_CONFIG_HOME || join(home, '.config'), '.wrangler'))
  }
  pushDir(join(home, '.config', '.wrangler'))
  pushDir(join(home, '.wrangler'))

  const seen = new Set<string>()
  const files: string[] = []
  for (const dir of dirs) {
    for (const file of [join(dir, 'config', 'default.toml'), join(dir, 'default.toml')]) {
      if (seen.has(file)) continue
      seen.add(file)
      files.push(file)
    }
  }
  return files
}

export function applyWranglerAuthRefresh(
  source: string,
  next: { oauthToken: string; refreshToken?: string | null; expirationTime: string }
): string {
  const set = (text: string, key: string, value: string): string => {
    const re = new RegExp(`^${key}\\s*=\\s*.+$`, 'im')
    const line = `${key} = ${JSON.stringify(value)}`
    if (re.test(text)) return text.replace(re, line)
    return `${text.replace(/\s*$/, '')}\n${line}\n`
  }
  let out = set(source, 'oauth_token', next.oauthToken)
  out = set(out, 'expiration_time', next.expirationTime)
  if (next.refreshToken) out = set(out, 'refresh_token', next.refreshToken)
  return out
}
