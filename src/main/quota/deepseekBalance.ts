import { request as httpsRequest } from 'node:https'
import { URL } from 'node:url'
import {
  deepseekBalanceUrl,
  parseDeepSeekBalance,
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

export async function fetchDeepSeekApiBalance(input: {
  apiKey: string | null | undefined
  endpoint: string
  force?: boolean
}): Promise<AnalysisApiBalance | null> {
  const apiKey = input.apiKey?.trim() ?? ''
  const url = deepseekBalanceUrl(input.endpoint)
  if (!apiKey || !url) return null
  const key = `${url}\n${apiKey}`
  if (!input.force && cache && cache.key === key && Date.now() - cache.at < STALE_MS) {
    return cache.value
  }
  try {
    const res = await getJson(url, {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json'
    })
    if (res.status < 200 || res.status >= 300) {
      console.error('[analysis] deepseek balance HTTP', res.status)
      return cache?.key === key ? cache.value : null
    }
    const value = parseDeepSeekBalance(res.body)
    if (!value) {
      console.error('[analysis] deepseek balance parse failed')
      return null
    }
    cache = { key, at: Date.now(), value }
    return value
  } catch (err) {
    console.error('[analysis] deepseek balance failed', err)
    return cache?.key === key ? cache.value : null
  }
}
