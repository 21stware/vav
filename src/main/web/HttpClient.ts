/**
 * HTTP GET/POST with SSRF re-check on every redirect hop, size and time limits.
 */

import { assertPublicHttpUrl, SsrfError, type PublicUrlOptions } from './ssrf'

export interface HttpGetOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  headers?: Record<string, string>
  method?: 'GET' | 'POST'
  body?: string
  contentType?: string
  ssrf?: PublicUrlOptions
  signal?: AbortSignal
}

export interface HttpResponse {
  url: string
  finalUrl: string
  status: number
  statusText: string
  headers: Record<string, string>
  contentType: string
  body: Buffer
  truncated: boolean
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 5

export function defaultUserAgent(version = 'dev'): string {
  return `vav/${version} (local agent; +https://vavapp.com)`
}

export async function httpRequest(
  rawUrl: string,
  options: HttpGetOptions = {}
): Promise<HttpResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS

  let method: 'GET' | 'POST' = options.method ?? 'GET'
  let body = options.body
  let contentType = options.contentType
  let current = await assertPublicHttpUrl(rawUrl, options.ssrf)
  let redirects = 0
  const originalUrl = current.href

  while (true) {
    const controller = new AbortController()
    const onParentAbort = (): void => controller.abort()
    if (options.signal) {
      if (options.signal.aborted) throw new SsrfError('Request aborted')
      options.signal.addEventListener('abort', onParentAbort, { once: true })
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const headers: Record<string, string> = {
        'User-Agent': defaultUserAgent(),
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        ...options.headers
      }
      if (body != null && contentType) {
        headers['Content-Type'] = contentType
      }

      const res = await fetch(current.href, {
        method,
        headers,
        body: method === 'POST' ? body : undefined,
        redirect: 'manual',
        signal: controller.signal
      })

      const status = res.status
      const location = res.headers.get('location')

      if (status >= 300 && status < 400 && location) {
        if (redirects >= maxRedirects) {
          throw new SsrfError(`Too many redirects (>${maxRedirects})`)
        }
        redirects++
        const next = new URL(location, current)
        current = await assertPublicHttpUrl(next.href, options.ssrf)
        // Browser-like: convert POST to GET on 301/302/303
        if (method === 'POST' && (status === 301 || status === 302 || status === 303)) {
          method = 'GET'
          body = undefined
          contentType = undefined
        }
        continue
      }

      const contentTypeHeader = res.headers.get('content-type') ?? ''
      const headerMap: Record<string, string> = {}
      res.headers.forEach((value, key) => {
        headerMap[key.toLowerCase()] = value
      })

      const { buffer, truncated } = await readBodyCapped(res, maxBytes)

      return {
        url: originalUrl,
        finalUrl: current.href,
        status,
        statusText: res.statusText,
        headers: headerMap,
        contentType: contentTypeHeader,
        body: buffer,
        truncated
      }
    } catch (err) {
      if (err instanceof SsrfError) throw err
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SsrfError(`Request timed out after ${timeoutMs}ms`)
      }
      throw err instanceof Error ? err : new Error(String(err))
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onParentAbort)
    }
  }
}

async function readBodyCapped(
  res: Response,
  maxBytes: number
): Promise<{ buffer: Buffer; truncated: boolean }> {
  if (!res.body) {
    const ab = await res.arrayBuffer()
    const buf = Buffer.from(ab)
    if (buf.length > maxBytes) return { buffer: buf.subarray(0, maxBytes), truncated: true }
    return { buffer: buf, truncated: false }
  }

  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  let truncated = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    const chunk = Buffer.from(value)
    if (total + chunk.length > maxBytes) {
      chunks.push(chunk.subarray(0, maxBytes - total))
      total = maxBytes
      truncated = true
      try {
        await reader.cancel()
      } catch {
        /* ignore */
      }
      break
    }
    chunks.push(chunk)
    total += chunk.length
  }
  return { buffer: Buffer.concat(chunks, total), truncated }
}
