/**
 * Locations the official Supabase CLI writes after `supabase login`.
 * Native keyring is preferred; the file is the fallback when keyring is down.
 */

import { join } from 'node:path'

export function supabaseAccessTokenFileCandidates(
  home: string,
  env: Record<string, string | undefined>
): string[] {
  const files: string[] = []
  const seen = new Set<string>()
  const push = (path: string): void => {
    const trimmed = path.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    files.push(trimmed)
  }
  if (env.SUPABASE_ACCESS_TOKEN_FILE) push(env.SUPABASE_ACCESS_TOKEN_FILE)
  if (env.SUPABASE_HOME) push(join(env.SUPABASE_HOME, 'access-token'))
  const xdg = env.XDG_CONFIG_HOME || join(home, '.config')
  push(join(xdg, 'supabase', 'access-token'))
  push(join(home, '.supabase', 'access-token'))
  return files
}

export function looksLikeSupabaseAccessToken(value: string): boolean {
  const token = value.trim()
  if (token.length < 20 || /\s/.test(token)) return false
  if (/error|not logged|usage:|unknown command/i.test(token)) return false
  return true
}
