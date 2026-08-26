import { request as httpsRequest } from 'node:https'
import { URL } from 'node:url'
import {
  openrouterCreditsUrl,
  openrouterKeyUrl,
  parseOpenRouterCredits,
  parseOpenRouterKey,
  type AnalysisApiBalance
} from '../../shared/apiBalance.ts'

const API_TIMEOUT_MS = 10_000
const STALE_MS = 5 * 60_000

let cache: { key: string; at: number; value: AnalysisApiBalance } | null = null

function getJson(url: string, headers: Record<string, string>): Promise<{
  status: number
  body: unknown
}> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = httpsRequest(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers,
        timeout: API_TIMEOUT_MS
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          let body: unknown = raw
          try {
            body = raw ? JSON.parse(raw) : null
          } catch {
            body = raw
          }
          resolve({ status: res.statusCode ?? 0, body })
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
    })
    req.end()
  })
}

async function getAuthorizedJson(
  url: string,
  apiKey: string
): Promise<{ status: number; body: unknown } | null> {
  try {
    return await getJson(url, {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json'
    })
  } catch (err) {
    console.error('[analysis] openrouter balance failed', err)
    return null
  }
}

export async function fetchOpenRouterApiBalance(input: {
  apiKey: string | null | undefined
  endpoint: string
  force?: boolean
}): Promise<AnalysisApiBalance | null> {
  const apiKey = input.apiKey?.trim() ?? ''
  const creditsUrl = openrouterCreditsUrl(input.endpoint)
  const keyUrl = openrouterKeyUrl(input.endpoint)
  if (!apiKey || (!creditsUrl && !keyUrl)) return null
  const cacheKey = `${creditsUrl ?? ''}\n${keyUrl ?? ''}\n${apiKey}`
  if (!input.force && cache && cache.key === cacheKey && Date.now() - cache.at < STALE_MS) {
    return cache.value
  }
  if (creditsUrl) {
    const res = await getAuthorizedJson(creditsUrl, apiKey)
    if (res && res.status >= 200 && res.status < 300) {
      const value = parseOpenRouterCredits(res.body)
      if (value) {
        cache = { key: cacheKey, at: Date.now(), value }
        return value
      }
      console.error('[analysis] openrouter credits parse failed')
    } else if (res && res.status !== 401 && res.status !== 403) {
      console.error('[analysis] openrouter credits HTTP', res.status)
    }
  }
  if (keyUrl) {
    const res = await getAuthorizedJson(keyUrl, apiKey)
    if (res && res.status >= 200 && res.status < 300) {
      const value = parseOpenRouterKey(res.body)
      if (value) {
        cache = { key: cacheKey, at: Date.now(), value }
        return value
      }
    } else if (res) {
      console.error('[analysis] openrouter key HTTP', res.status)
    }
  }
  return cache?.key === cacheKey ? cache.value : null
}
