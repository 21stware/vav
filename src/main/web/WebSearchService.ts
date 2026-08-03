/**
 * Local web search for the agent (no mandatory API key).
 *
 * Backends (auto waterfall):
 *  1. Brave Search API — when subscription token is present
 *  2. SearXNG JSON — when base URL is configured (localhost allowed)
 *  3. DuckDuckGo HTML — zero-config default
 */

import { SsrfError, assertPublicHttpUrl } from './ssrf'
import { httpRequest } from './HttpClient'
import { parseHTML } from 'linkedom'

export interface WebSearchHit {
  rank: number
  title: string
  url: string
  snippet: string
}

export type WebSearchProvider = 'auto' | 'duckduckgo' | 'searxng' | 'brave'

export interface WebSearchOptions {
  query: string
  numResults?: number
  site?: string
  timeoutMs?: number
  signal?: AbortSignal
  /** e.g. http://127.0.0.1:8080 — enables SearXNG */
  searxngBaseUrl?: string
  /** Brave Search API subscription token (optional). */
  braveApiKey?: string
  provider?: WebSearchProvider
}

export interface WebSearchResult {
  ok: boolean
  error?: string
  query: string
  via?: string
  warnings?: string[]
  hits: WebSearchHit[]
}

const MAX_RESULTS = 12
const DEFAULT_RESULTS = 8

export class WebSearchService {
  async search(opts: WebSearchOptions): Promise<WebSearchResult> {
    const rawQuery = opts.query.trim()
    if (!rawQuery) {
      return { ok: false, error: 'Missing query', query: '', hits: [] }
    }
    const site = opts.site?.trim().replace(/^site:/i, '') || ''
    const query = site ? `${rawQuery} site:${site}` : rawQuery
    const num = clamp(opts.numResults ?? DEFAULT_RESULTS, 1, MAX_RESULTS)
    const warnings: string[] = []
    const provider = opts.provider ?? 'auto'
    const braveKey = opts.braveApiKey?.trim() || ''
    const searx = opts.searxngBaseUrl?.trim() || ''

    const tryBrave =
      (provider === 'auto' || provider === 'brave') && braveKey.length > 0
    const trySearx =
      (provider === 'auto' || provider === 'searxng') && searx.length > 0
    const tryDdg = provider === 'auto' || provider === 'duckduckgo'

    if (provider === 'brave' && !braveKey) {
      return {
        ok: false,
        error: 'Brave Search selected but no API key is configured (Settings → Workspace).',
        query,
        via: 'brave',
        hits: []
      }
    }
    if (provider === 'searxng' && !searx) {
      return {
        ok: false,
        error: 'SearXNG selected but no base URL is configured (Settings → Workspace).',
        query,
        via: 'searxng',
        hits: []
      }
    }

    if (tryBrave) {
      try {
        const hits = await searchBrave(braveKey, query, num, opts)
        if (hits.length > 0) {
          return {
            ok: true,
            query,
            via: 'brave',
            hits,
            warnings: warnings.length ? warnings : undefined
          }
        }
        warnings.push('Brave returned no results')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        warnings.push(`Brave failed: ${msg}`)
        if (provider === 'brave') {
          return { ok: false, error: msg, query, via: 'brave', hits: [], warnings }
        }
      }
    }

    if (trySearx) {
      try {
        const hits = await searchSearxng(searx, query, num, opts)
        if (hits.length > 0) {
          return {
            ok: true,
            query,
            via: 'searxng',
            hits,
            warnings: warnings.length ? warnings : undefined
          }
        }
        warnings.push('SearXNG returned no results')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        warnings.push(`SearXNG failed: ${msg}`)
        if (provider === 'searxng') {
          return { ok: false, error: msg, query, via: 'searxng', hits: [], warnings }
        }
      }
    }

    if (tryDdg) {
      try {
        const hits = await searchDuckDuckGoHtml(query, num, opts)
        if (hits.length > 0) {
          return {
            ok: true,
            query,
            via: 'duckduckgo-html',
            hits,
            warnings: warnings.length ? warnings : undefined
          }
        }
        warnings.push('DuckDuckGo returned no results')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        warnings.push(`DuckDuckGo failed: ${msg}`)
        if (provider === 'duckduckgo' || (!tryBrave && !trySearx)) {
          return { ok: false, error: msg, query, via: 'duckduckgo-html', hits: [], warnings }
        }
      }
    }

    return {
      ok: false,
      error: warnings.join('; ') || 'No search backend available',
      query,
      hits: [],
      warnings
    }
  }

  formatForModel(result: WebSearchResult): string {
    if (!result.ok) {
      return `web_search failed for "${result.query}": ${result.error}`
    }
    const head = [
      `Found ${result.hits.length} result(s) for "${result.query}"` +
        (result.via ? ` · via ${result.via}` : '') +
        (result.warnings?.length ? ` · ${result.warnings.join('; ')}` : ''),
      ''
    ]
    const body = result.hits.map((hit) => {
      return [
        `${hit.rank}. [web:${hit.rank}] ${hit.title}`,
        `   url: ${hit.url}`,
        hit.snippet ? `   snippet: ${hit.snippet}` : null,
        ''
      ]
        .filter(Boolean)
        .join('\n')
    })
    return [...head, ...body].join('\n').trim() + '\n'
  }

  formatForDisplay(result: WebSearchResult): string {
    if (!result.ok) return result.error || 'Search failed'
    return this.formatForModel(result)
  }
}

async function searchBrave(
  apiKey: string,
  query: string,
  num: number,
  opts: WebSearchOptions
): Promise<WebSearchHit[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(num))

  const res = await httpRequest(url.href, {
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
      'User-Agent': 'vav (local agent; +https://vavapp.com)'
    }
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Brave HTTP ${res.status}: ${res.body.toString('utf8').slice(0, 200)}`)
  }
  let data: {
    web?: {
      results?: Array<{ title?: string; url?: string; description?: string }>
    }
  }
  try {
    data = JSON.parse(res.body.toString('utf8')) as typeof data
  } catch {
    throw new Error('Brave returned non-JSON')
  }

  const hits: WebSearchHit[] = []
  const seen = new Set<string>()
  for (const r of data.web?.results ?? []) {
    if (hits.length >= num) break
    const href = (r.url || '').trim()
    const title = collapseWs(r.title || '').trim()
    if (!href || !title || !/^https?:\/\//i.test(href)) continue
    const key = normalizeUrlKey(href)
    if (seen.has(key)) continue
    seen.add(key)
    hits.push({
      rank: hits.length + 1,
      title,
      url: href,
      snippet: collapseWs(r.description || '')
        .trim()
        .slice(0, 320)
    })
  }
  return hits
}

async function searchDuckDuckGoHtml(
  query: string,
  num: number,
  opts: WebSearchOptions
): Promise<WebSearchHit[]> {
  // GET html.duckduckgo.com — POST often returns a 202 interstitial without results.
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await httpRequest(url, {
    method: 'GET',
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      Referer: 'https://html.duckduckgo.com/',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`DuckDuckGo HTTP ${res.status}`)
  }
  const html = res.body.toString('utf8')
  const hits = parseDdgHtml(html, num)
  if (
    hits.length === 0 &&
    (html.includes('anomaly') || html.includes('challenge') || !html.includes('result__'))
  ) {
    throw new Error('DuckDuckGo returned a challenge or empty results page')
  }
  return hits
}

interface DomLike {
  querySelector(sel: string): DomEl | null
  querySelectorAll(sel: string): ArrayLike<DomEl>
}

interface DomEl {
  className?: string | { toString(): string }
  textContent: string | null
  getAttribute(name: string): string | null
  querySelector(sel: string): DomEl | null
}

function parseDdgHtml(html: string, num: number): WebSearchHit[] {
  const { document } = parseHTML(html)
  const doc = document as unknown as DomLike
  const hits: WebSearchHit[] = []
  const seen = new Set<string>()

  const results = doc.querySelectorAll('.result, .web-result, .links_main')
  for (let i = 0; i < results.length; i++) {
    if (hits.length >= num) break
    const el = results[i]!
    if (el.className != null && String(el.className).includes('result--ad')) continue

    const a =
      el.querySelector('a.result__a') ||
      el.querySelector('a.result-link') ||
      el.querySelector('h2 a') ||
      el.querySelector('a[href]')
    if (!a) continue

    let href = a.getAttribute('href') || ''
    href = unwrapDdgRedirect(href)
    if (!href || !/^https?:\/\//i.test(href)) continue

    const title = collapseWs(a.textContent || '').trim()
    if (!title) continue

    const snipEl =
      el.querySelector('.result__snippet') ||
      el.querySelector('.result-snippet') ||
      el.querySelector('.snippet')
    const snippet = collapseWs(snipEl?.textContent || '')
      .trim()
      .slice(0, 320)

    const key = normalizeUrlKey(href)
    if (seen.has(key)) continue
    seen.add(key)

    hits.push({
      rank: hits.length + 1,
      title,
      url: href,
      snippet
    })
  }

  if (hits.length === 0) {
    const anchors = doc.querySelectorAll('a.result__a')
    for (let i = 0; i < anchors.length; i++) {
      if (hits.length >= num) break
      const a = anchors[i]!
      let href = a.getAttribute('href') || ''
      href = unwrapDdgRedirect(href)
      if (!href || !/^https?:\/\//i.test(href)) continue
      const title = collapseWs(a.textContent || '').trim()
      if (!title) continue
      const key = normalizeUrlKey(href)
      if (seen.has(key)) continue
      seen.add(key)
      hits.push({ rank: hits.length + 1, title, url: href, snippet: '' })
    }
  }

  return hits
}

function unwrapDdgRedirect(href: string): string {
  try {
    const absolute = href.startsWith('//')
      ? `https:${href}`
      : href.startsWith('/l/?')
        ? `https://duckduckgo.com${href}`
        : href
    const u = new URL(absolute, 'https://duckduckgo.com')
    if (u.hostname.endsWith('duckduckgo.com') && u.pathname === '/l/') {
      const uddg = u.searchParams.get('uddg')
      if (uddg) return decodeURIComponent(uddg)
    }
    return absolute.startsWith('http') ? absolute : href
  } catch {
    return href
  }
}

async function searchSearxng(
  baseUrl: string,
  query: string,
  num: number,
  opts: WebSearchOptions
): Promise<WebSearchHit[]> {
  let base: URL
  try {
    base = new URL(baseUrl.includes('://') ? baseUrl : `http://${baseUrl}`)
  } catch {
    throw new SsrfError(`Invalid SearXNG base URL: ${baseUrl}`)
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new SsrfError('SearXNG base URL must be http(s)')
  }

  const host = base.hostname.toLowerCase()
  const allowLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local')

  const searchUrl = new URL('/search', base)
  searchUrl.searchParams.set('q', query)
  searchUrl.searchParams.set('format', 'json')
  searchUrl.searchParams.set('categories', 'general')

  if (!allowLocal) {
    await assertPublicHttpUrl(searchUrl.href, { allowNonStandardPorts: true })
  }

  const res = await httpRequest(searchUrl.href, {
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    ssrf: allowLocal
      ? {
          allowNonStandardPorts: true,
          allowHosts: new Set([host])
        }
      : { allowNonStandardPorts: true }
  })

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`SearXNG HTTP ${res.status}`)
  }

  let data: { results?: Array<{ title?: string; url?: string; content?: string }> }
  try {
    data = JSON.parse(res.body.toString('utf8')) as typeof data
  } catch {
    throw new Error('SearXNG returned non-JSON')
  }

  const hits: WebSearchHit[] = []
  const seen = new Set<string>()
  for (const r of data.results ?? []) {
    if (hits.length >= num) break
    const url = (r.url || '').trim()
    const title = collapseWs(r.title || '').trim()
    if (!url || !title || !/^https?:\/\//i.test(url)) continue
    const key = normalizeUrlKey(url)
    if (seen.has(key)) continue
    seen.add(key)
    hits.push({
      rank: hits.length + 1,
      title,
      url,
      snippet: collapseWs(r.content || '')
        .trim()
        .slice(0, 320)
    })
  }
  return hits
}

function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    for (const key of [...u.searchParams.keys()]) {
      if (/^utm_/i.test(key) || key === 'fbclid' || key === 'gclid') {
        u.searchParams.delete(key)
      }
    }
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}`
  } catch {
    return url
  }
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ')
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}
