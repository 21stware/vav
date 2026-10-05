import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { net } from 'electron'
import {
  factoryApiKeyFromEnvFile,
  parseDroidDoctorAuth,
  unknownAccount,
  type HostAccountInfo
} from '@shared/cliAccountParse'
import { windowsFromDroidBillingLimits } from '@shared/quotaWindows'
import type { QuotaWindow } from '@shared/types'
import { execCliJson } from './cliProbe'

const FACTORY_API_BASE =
  process.env.FACTORY_API_BASE_URL?.trim().replace(/\/$/, '') || 'https://api.factory.ai'
const BILLING_LIMITS_URL = `${FACTORY_API_BASE}/api/billing/limits`
const API_TIMEOUT_MS = 10_000

export async function readDroidAccountInfo(): Promise<HostAccountInfo> {
  const report = await execCliJson(['droid'], ['doctor', '--auth', '--json'])
  if (!report) return unknownAccount()
  return parseDroidDoctorAuth(report)
}

/**
 * Droid's stored login is encrypted (`~/.factory/auth.v2.*`), so only an
 * explicit Factory API key can authorize the billing poll.
 */
async function readFactoryApiKey(): Promise<string | null> {
  const env = process.env.FACTORY_API_KEY?.trim()
  if (env) return env
  try {
    return factoryApiKeyFromEnvFile(await readFile(join(homedir(), '.factory', '.env'), 'utf8'))
  } catch {
    return null
  }
}

export async function fetchDroidAccountQuota(ctx?: { token?: string }): Promise<QuotaWindow[]> {
  const token = ctx?.token?.trim() || (await readFactoryApiKey())
  if (!token) return []
  const res = await net.fetch(BILLING_LIMITS_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'x-factory-client': 'web-app'
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS)
  })
  if (!res.ok) return []
  return windowsFromDroidBillingLimits(await res.json())
}
