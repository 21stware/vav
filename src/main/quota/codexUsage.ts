import { readFile } from 'node:fs/promises'
import { net } from 'electron'
import { parseCodexAuthFile, type HostAccountInfo } from '@shared/cliAccountParse'
import { windowsFromCodexBackendPayload } from '@shared/quotaWindows'
import type { QuotaWindow } from '@shared/types'
import { codexAuthPath } from './hostPaths.ts'

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const API_TIMEOUT_MS = 10_000

async function readCodexAuthHeaders(): Promise<Record<string, string> | null> {
  try {
    const raw = await readFile(codexAuthPath(), 'utf8')
    const parsed = JSON.parse(raw) as {
      tokens?: { access_token?: unknown; account_id?: unknown }
    }
    const accessToken = parsed.tokens?.access_token
    if (typeof accessToken !== 'string' || !accessToken.trim()) return null
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken.trim()}`,
      'User-Agent': 'codex-cli',
      'OpenAI-Beta': 'codex-1',
      originator: 'Codex Desktop'
    }
    const accountId = parsed.tokens?.account_id
    if (typeof accountId === 'string' && accountId.trim()) {
      headers['ChatGPT-Account-Id'] = accountId.trim()
    }
    return headers
  } catch {
    return null
  }
}

function codexEnvKeys(): Array<string | undefined> {
  return [process.env.OPENAI_API_KEY, process.env.CODEX_API_KEY]
}

/** ChatGPT account id from Codex auth.json, when present. */
export async function readCodexAuthIdentity(): Promise<string | null> {
  try {
    const raw = await readFile(codexAuthPath(), 'utf8')
    const parsed = JSON.parse(raw) as { tokens?: { account_id?: unknown } }
    const accountId = parsed.tokens?.account_id
    if (typeof accountId === 'string' && accountId.trim()) return accountId.trim()
  } catch {
    // missing / malformed
  }
  const info = await readCodexAccountInfo()
  return info.authKind === 'api-key' ? 'apikey' : null
}

/** ChatGPT OAuth, API key in auth.json / env, or expired tokens. */
export async function readCodexAccountInfo(): Promise<HostAccountInfo> {
  try {
    const raw = await readFile(codexAuthPath(), 'utf8')
    return parseCodexAuthFile(JSON.parse(raw), codexEnvKeys())
  } catch {
    // missing / malformed
  }
  return parseCodexAuthFile(null, codexEnvKeys())
}

export async function fetchCodexAccountQuota(ctx?: { token?: string }): Promise<QuotaWindow[]> {
  const token = ctx?.token?.trim()
  const headers = token
    ? {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'codex-cli',
        'OpenAI-Beta': 'codex-1',
        originator: 'Codex Desktop'
      }
    : await readCodexAuthHeaders()
  if (!headers) return []
  const res = await net.fetch(USAGE_URL, {
    headers: { ...headers, Accept: 'application/json' },
    signal: AbortSignal.timeout(API_TIMEOUT_MS)
  })
  if (!res.ok) return []
  return windowsFromCodexBackendPayload(await res.json())
}
