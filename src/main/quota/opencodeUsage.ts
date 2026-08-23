import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { net } from 'electron'
import {
  accountInfo,
  emptyAccount,
  parseOpencodeAuthFile,
  type HostAccountInfo
} from '@shared/cliAccountParse'
import { windowsFromOpencodeGoUsagePayload } from '@shared/quotaWindows'
import type { QuotaWindow } from '@shared/types'
import { opencodeAuthPath } from './hostPaths.ts'

const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
const API_TIMEOUT_MS = 10_000

async function readOpencodeGoKey(): Promise<string | null> {
  const env = process.env.OPENCODE_API_KEY?.trim()
  if (env) return env
  try {
    const raw = await readFile(opencodeAuthPath(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, { type?: unknown; key?: unknown }>
    for (const id of ['opencode-go', 'opencode', 'zen']) {
      const key = parsed[id]?.key
      if (typeof key === 'string' && key.trim()) return key.trim()
    }
    for (const entry of Object.values(parsed ?? {})) {
      const key = entry?.key
      if (typeof key === 'string' && key.trim()) return key.trim()
    }
  } catch {
    // missing / malformed
  }
  return null
}

export async function readOpencodeAccountInfo(): Promise<HostAccountInfo> {
  const env = process.env.OPENCODE_API_KEY?.trim()
  try {
    const raw = await readFile(opencodeAuthPath(), 'utf8')
    const fromFile = parseOpencodeAuthFile(JSON.parse(raw))
    if (fromFile.signedIn) return fromFile
  } catch {
    // missing / malformed
  }
  if (env) return accountInfo('api-key')
  return emptyAccount()
}

export async function readOpencodeAuthIdentity(): Promise<string | null> {
  const key = await readOpencodeGoKey()
  if (!key) return null
  return `tok:${createHash('sha256').update(key).digest('hex').slice(0, 16)}`
}

export async function fetchOpencodeAccountQuota(ctx?: { token?: string }): Promise<QuotaWindow[]> {
  const key = ctx?.token?.trim() || (await readOpencodeGoKey())
  if (!key) return []
  const res = await net.fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'User-Agent': 'opencode'
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS)
  })
  if (!res.ok) return []
  return windowsFromOpencodeGoUsagePayload(await res.json())
}
