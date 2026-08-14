import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { net } from 'electron'
import { windowsFromClaudeOAuthPayload } from '@shared/quotaWindows'
import type { QuotaWindow } from '@shared/types'

const execFileAsync = promisify(execFile)
const OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA_HEADER = 'oauth-2025-04-20'
const CLAUDE_CODE_USER_AGENT = 'claude-code/2.1.0'
const API_TIMEOUT_MS = 10_000
const KEYCHAIN_TIMEOUT_MS = 3_000
const ACTIVE_CLAUDE_SERVICE = 'Claude Code-credentials'

function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
}

function keychainUser(): string {
  return process.env.USER || process.env.USERNAME || 'user'
}

function keychainService(configDir: string): string {
  const suffix = createHash('sha256').update(configDir).digest('hex').slice(0, 8)
  return `${ACTIVE_CLAUDE_SERVICE}-${suffix}`
}

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
      ['find-generic-password', '-s', service, '-a', keychainUser(), '-w'],
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
    for (const service of [keychainService(configDir), ACTIVE_CLAUDE_SERVICE]) {
      const raw = await readKeychainPassword(service)
      const token = raw ? tokenFromCredentialsJson(raw) : null
      if (token) return token
    }
  }
  try {
    const raw = await readFile(join(configDir, '.credentials.json'), 'utf8')
    return tokenFromCredentialsJson(raw)
  } catch {
    return null
  }
}

/** Fingerprint of the current Claude Code OAuth token (login switch). */
export async function readClaudeAuthIdentity(): Promise<string | null> {
  const token = await readClaudeAccessToken()
  if (!token) return null
  return `tok:${createHash('sha256').update(token).digest('hex').slice(0, 16)}`
}

export async function fetchClaudeAccountQuota(): Promise<QuotaWindow[]> {
  const token = await readClaudeAccessToken()
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
