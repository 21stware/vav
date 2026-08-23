import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { net } from 'electron'
import {
  accountInfo,
  emptyAccount,
  hostFromAnthropicBaseUrl,
  parseClaudeAuthStatusPayload,
  resolveClaudeAccount,
  type HostAccountInfo
} from '@shared/cliAccountParse'
import { windowsFromClaudeOAuthPayload } from '@shared/quotaWindows'
import type { QuotaWindow } from '@shared/types'
import { execCliJson } from './cliProbe'
import {
  claudeConfigDir,
  claudeCredentialsPath,
  claudeKeychainService,
  claudeKeychainUser
} from './hostPaths.ts'

const execFileAsync = promisify(execFile)
const OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA_HEADER = 'oauth-2025-04-20'
const CLAUDE_CODE_USER_AGENT = 'claude-code/2.1.0'
const API_TIMEOUT_MS = 10_000
const KEYCHAIN_TIMEOUT_MS = 3_000
const ACTIVE_CLAUDE_SERVICE = 'Claude Code-credentials'

export { claudeCredentialsPath, claudeKeychainService, claudeKeychainUser }

function tokenFromCredentialsJson(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: unknown } }
    const token = parsed?.claudeAiOauth?.accessToken
    return typeof token === 'string' && token.trim() ? token.trim() : null
  } catch {
    return null
  }
}

async function readKeychainPassword(service: string): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  try {
    const { stdout } = await execFileAsync(
      'security',
      ['find-generic-password', '-s', service, '-a', claudeKeychainUser(), '-w'],
      { timeout: KEYCHAIN_TIMEOUT_MS, maxBuffer: 1024 * 1024 }
    )
    const raw = stdout.toString().trim()
    return raw ? raw : null
  } catch {
    return null
  }
}

async function readClaudeAccessToken(): Promise<string | null> {
  const configDir = claudeConfigDir()
  if (process.platform === 'darwin') {
    for (const service of [claudeKeychainService(configDir), ACTIVE_CLAUDE_SERVICE]) {
      const raw = await readKeychainPassword(service)
      const token = raw ? tokenFromCredentialsJson(raw) : null
      if (token) return token
    }
  }
  const files = [
    claudeCredentialsPath(configDir),
    join(homedir(), '.config', 'claude', '.credentials.json')
  ]
  for (const file of files) {
    try {
      const raw = await readFile(file, 'utf8')
      const token = tokenFromCredentialsJson(raw)
      if (token) return token
    } catch {
      // next
    }
  }
  return null
}

function envString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function mergeClaudeSettingsEnv(): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  const dir = claudeConfigDir()
  for (const name of ['settings.json', 'settings.local.json']) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
        env?: unknown
      }
      const env = parsed.env
      if (env && typeof env === 'object' && !Array.isArray(env)) {
        Object.assign(merged, env)
      }
    } catch {
      // missing / malformed
    }
  }
  return merged
}

function readClaudeSettingsEnv(): { token: string | null; customHost: string | null } {
  const env = mergeClaudeSettingsEnv()
  const token =
    envString(env.ANTHROPIC_AUTH_TOKEN) ||
    envString(env.ANTHROPIC_API_KEY) ||
    process.env.ANTHROPIC_AUTH_TOKEN?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    null
  const customHost = hostFromAnthropicBaseUrl(
    envString(env.ANTHROPIC_BASE_URL) ?? process.env.ANTHROPIC_BASE_URL
  )
  return { token, customHost }
}

/** Fingerprint of the current Claude token (OAuth or settings env). */
export async function readClaudeAuthIdentity(): Promise<string | null> {
  const token = (await readClaudeAccessToken()) ?? readClaudeSettingsEnv().token
  if (!token) return null
  return `tok:${createHash('sha256').update(token).digest('hex').slice(0, 16)}`
}

/**
 * Settings / env token wins over leftover `claude auth status` OAuth.
 * Official login is only used when no token is configured.
 */
export async function readClaudeAccountInfo(): Promise<HostAccountInfo> {
  const settings = readClaudeSettingsEnv()
  const status = await execCliJson(['claude'], ['auth', 'status', '--json'])
  const resolved = resolveClaudeAccount(settings, parseClaudeAuthStatusPayload(status))
  if (resolved.signedIn) return resolved
  if (await readClaudeAccessToken()) return accountInfo('oauth', { plan: settings.customHost })
  return emptyAccount()
}

export async function fetchClaudeAccountQuota(ctx?: { token?: string }): Promise<QuotaWindow[]> {
  // Custom token / gateway has no Anthropic subscription windows.
  if (!ctx?.token && readClaudeSettingsEnv().token) return []
  const token = ctx?.token?.trim() || (await readClaudeAccessToken())
  if (!token) return []
  const res = await net.fetch(OAUTH_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': OAUTH_BETA_HEADER,
      'User-Agent': CLAUDE_CODE_USER_AGENT
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS)
  })
  if (!res.ok) return []
  return windowsFromClaudeOAuthPayload(await res.json())
}
