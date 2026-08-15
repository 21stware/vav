import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { net } from 'electron'
import { emptyAccount, parseCursorStatusPayload, type HostAccountInfo } from '@shared/cliAccountParse'
import { windowsFromCursorPeriodPayload } from '@shared/quotaWindows'
import type { QuotaWindow } from '@shared/types'
import { execCliJson } from './cliProbe'

const execFileAsync = promisify(execFile)
const USAGE_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage'
const API_TIMEOUT_MS = 10_000
const KEYCHAIN_TIMEOUT_MS = 3_000
const ACCESS_SERVICE = 'cursor-access-token'

async function readCursorAccessToken(): Promise<string | null> {
  const env = process.env.CURSOR_API_KEY?.trim()
  if (env) return env
  if (process.platform !== 'darwin') return null
  try {
    const { stdout } = await execFileAsync(
      'security',
      ['find-generic-password', '-s', ACCESS_SERVICE, '-w'],
      { timeout: KEYCHAIN_TIMEOUT_MS, maxBuffer: 64 * 1024 }
    )
    const token = stdout.toString().trim()
    return token || null
  } catch {
    return null
  }
}

/** `cursor-agent status --format json` — email + subscription, not keychain. */
export async function readCursorAccountInfo(): Promise<HostAccountInfo> {
  const status = await execCliJson(['cursor-agent', 'agent'], ['status', '--format', 'json'])
  const fromStatus = parseCursorStatusPayload(status)
  if (fromStatus.signedIn || fromStatus.accountId) {
    if (!fromStatus.plan) {
      const about = await execCliJson(['cursor-agent', 'agent'], ['about', '--format', 'json'])
      const fromAbout = parseCursorStatusPayload(about)
      if (fromAbout.plan) return { ...fromStatus, plan: fromAbout.plan, signedIn: true }
    }
    return { ...fromStatus, signedIn: true }
  }
  const about = await execCliJson(['cursor-agent', 'agent'], ['about', '--format', 'json'])
  const fromAbout = parseCursorStatusPayload(about)
  if (fromAbout.accountId || fromAbout.plan) {
    return { signedIn: true, accountId: fromAbout.accountId, plan: fromAbout.plan }
  }
  const token = await readCursorAccessToken()
  if (token) return { signedIn: true, accountId: null, plan: null }
  return emptyAccount()
}

export async function readCursorAuthIdentity(): Promise<string | null> {
  const token = await readCursorAccessToken()
  if (token) return `tok:${createHash('sha256').update(token).digest('hex').slice(0, 16)}`
  const info = await readCursorAccountInfo()
  return info.accountId ? `user:${info.accountId}` : null
}

export async function fetchCursorAccountQuota(): Promise<QuotaWindow[]> {
  const token = await readCursorAccessToken()
  if (!token) return []
  const res = await net.fetch(USAGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'cursor-agent'
    },
    body: '{}',
    signal: AbortSignal.timeout(API_TIMEOUT_MS)
  })
  if (!res.ok) return []
  return windowsFromCursorPeriodPayload(await res.json())
}
