/**
 * Fetch a public URL and extract readable text for the agent.
 *
 * Paths: HTTP → (optional Chromium render for SPA shells) → extract
 * (HTML Readability / JSON / text / PDF via pdf.js).
 */

import { SsrfError } from './ssrf'
import { httpRequest, type HttpGetOptions } from './HttpClient'
import { articleToMarkdown, extractArticle } from './htmlToMarkdown'
import { extractPdfTextFromBuffer } from './pdfText'
import { RenderedHtmlFetcher } from './RenderedHtmlFetcher'

export type WebExtractMode = 'auto' | 'markdown' | 'text' | 'raw'

export interface WebFetchOptions {
  url: string
  extract?: WebExtractMode
  maxChars?: number
  startLine?: number
  timeoutMs?: number
  signal?: AbortSignal
  userAgentVersion?: string
  /** When true, upgrade thin/SPA HTML via hidden Chromium. */
  allowRender?: boolean
}

export interface WebFetchResult {
  ok: boolean
  error?: string
  url: string
  finalUrl?: string
  status?: number
  contentType?: string
  title?: string
  /** Extraction path label for the model, e.g. markdown, markdown+render, text. */
  extracted?: string
  body?: string
  chars?: number
  truncated?: boolean
  startLine?: number
}

const DEFAULT_MAX_CHARS = 12_000
const HARD_MAX_CHARS = 40_000
/** Below this, treat HTML as a likely SPA shell and consider render upgrade. */
const THIN_HTML_CHARS = 400
const PDF_MAX_PAGES = 40

interface CacheEntry {
  result: WebFetchResult
  at: number
}

export class WebFetchService {
  private cache = new Map<string, CacheEntry>()
  private readonly ttlMs = 10 * 60 * 1000
  private readonly maxEntries = 32
  private readonly renderer = new RenderedHtmlFetcher()

  async fetch(opts: WebFetchOptions): Promise<WebFetchResult> {
    const url = opts.url.trim()
    if (!url) return { ok: false, error: 'Missing url', url: '' }

    const maxChars = clamp(opts.maxChars ?? DEFAULT_MAX_CHARS, 500, HARD_MAX_CHARS)
    const extract = opts.extract ?? 'auto'
    const allowRender = opts.allowRender === true
    const cacheKey = `${url}|${extract}|${maxChars}|${opts.startLine ?? 1}|r:${allowRender ? 1 : 0}`
    const hit = this.cache.get(cacheKey)
    if (hit && Date.now() - hit.at < this.ttlMs) {
      return { ...hit.result }
    }

    try {
      const res = await httpRequest(url, {
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
        headers: opts.userAgentVersion
          ? { 'User-Agent': `vav/${opts.userAgentVersion} (local agent; +https://vavapp.com)` }
          : undefined
      } satisfies HttpGetOptions)

      if (res.status < 200 || res.status >= 300) {
        return {
          ok: false,
          error: `HTTP ${res.status} ${res.statusText}`,
          url,
          finalUrl: res.finalUrl,
          status: res.status,
          contentType: res.contentType
        }
      }

      const mime = primaryMime(res.contentType)
      const rawText = decodeBody(res.body, res.contentType)

      let title = ''
      let extractedMode: string = extract
      let body = ''
      let finalUrl = res.finalUrl
      const contentType = res.contentType
      const status = res.status
      let truncated = res.truncated

      if (extract === 'raw') {
        body = rawText
        extractedMode = 'raw'
      } else if (isPdf(mime, res.body)) {
        const pdf = await extractPdfTextFromBuffer(res.body, { maxPages: PDF_MAX_PAGES })
        if (!pdf.text.trim()) {
          return {
            ok: false,
            error: 'PDF had no extractable text (scanned image PDF?)',
            url,
            finalUrl,
            status,
            contentType
          }
        }
        body = pdf.text
        if (pdf.scannedPages < pdf.pageCount) {
          body += `\n\n[Note: extracted first ${pdf.scannedPages} of ${pdf.pageCount} pages]`
        }
        title = basenameFromUrl(finalUrl)
        extractedMode = 'text'
      } else if (isHtml(mime, rawText)) {
        let html = rawText
        let article = extractArticle(html, finalUrl)
        let usedRender = false

        const thin =
          !article.usedReadability ||
          (article.textContent?.trim().length ?? 0) < THIN_HTML_CHARS ||
          looksLikeSpaShell(html, article.textContent)

        if (allowRender && thin) {
          const rendered = await this.renderer.fetch({
            url: finalUrl,
            timeoutMs: opts.timeoutMs,
            signal: opts.signal
          })
          if (rendered.ok && rendered.html) {
            html = rendered.html
            finalUrl = rendered.finalUrl || finalUrl
            article = extractArticle(html, finalUrl)
            usedRender = true
            if (rendered.title && !article.title) article = { ...article, title: rendered.title }
          }
        }

        title = article.title
        if (extract === 'text') {
          body = article.textContent
          extractedMode = usedRender ? 'text+render' : 'text'
        } else {
          body = articleToMarkdown(article, finalUrl)
          if (!body.trim()) body = article.textContent
          extractedMode = usedRender ? 'markdown+render' : 'markdown'
        }
      } else if (isJson(mime)) {
        try {
          body = JSON.stringify(JSON.parse(rawText), null, 2)
        } catch {
          body = rawText
        }
        extractedMode = 'text'
        title = finalUrl
      } else if (
        mime.startsWith('text/') ||
        mime === 'application/xml' ||
        mime === 'application/javascript'
      ) {
        body = rawText
        extractedMode = 'text'
      } else {
        return {
          ok: false,
          error: `Unsupported content type: ${contentType || mime || 'unknown'} (HTML/text/JSON/PDF)`,
          url,
          finalUrl,
          status,
          contentType
        }
      }

      body = normalizeNewlines(body)
      const startLine = Math.max(1, Math.floor(opts.startLine ?? 1))
      if (startLine > 1) {
        const lines = body.split('\n')
        body = lines.slice(startLine - 1).join('\n')
      }

      if (body.length > maxChars) {
        body = body.slice(0, maxChars)
        truncated = true
      }

      const result: WebFetchResult = {
        ok: true,
        url,
        finalUrl,
        status,
        contentType,
        title: title || undefined,
        extracted: extractedMode,
        body,
        chars: body.length,
        truncated,
        startLine: startLine > 1 ? startLine : undefined
      }
      this.putCache(cacheKey, result)
      return result
    } catch (err) {
      const msg =
        err instanceof SsrfError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
      return { ok: false, error: msg, url }
    }
  }

  formatForModel(result: WebFetchResult): string {
    if (!result.ok) {
      return `web_fetch failed for ${result.url}: ${result.error}`
    }
    const lines = [
      result.title ? `# ${result.title}` : null,
      `final_url: ${result.finalUrl ?? result.url}`,
      result.contentType ? `content_type: ${result.contentType}` : null,
      result.extracted ? `extracted: ${result.extracted}` : null,
      `chars: ${result.chars ?? 0}${result.truncated ? ' (truncated=true)' : ''}`,
      result.startLine ? `start_line: ${result.startLine}` : null,
      '',
      '---',
      '',
      result.body ?? ''
    ].filter((x) => x != null) as string[]
    return lines.join('\n')
  }

  private putCache(key: string, result: WebFetchResult): void {
    this.cache.set(key, { result, at: Date.now() })
    if (this.cache.size <= this.maxEntries) return
    const ordered = [...this.cache.entries()].sort((a, b) => a[1].at - b[1].at)
    const drop = ordered.length - this.maxEntries
    for (let i = 0; i < drop; i++) this.cache.delete(ordered[i]![0])
  }
}

function primaryMime(contentType: string): string {
  return (contentType.split(';')[0] ?? '').trim().toLowerCase()
}

function isHtml(mime: string, body: string): boolean {
  if (mime.includes('html') || mime === 'application/xhtml+xml') return true
  if (mime && mime !== 'application/octet-stream' && mime !== '') return false
  const head = body.slice(0, 256).toLowerCase()
  return head.includes('<html') || head.includes('<!doctype html')
}

function isJson(mime: string): boolean {
  return mime === 'application/json' || mime.endsWith('+json')
}

function isPdf(mime: string, body: Buffer): boolean {
  if (mime === 'application/pdf' || mime.endsWith('+pdf')) return true
  // Magic: %PDF-
  return body.length >= 5 && body.subarray(0, 5).toString('ascii') === '%PDF-'
}

/**
 * Heuristic: little readable text relative to markup, or classic SPA mount points.
 */
function looksLikeSpaShell(html: string, textContent: string): boolean {
  const text = textContent.replace(/\s+/g, ' ').trim()
  if (text.length >= THIN_HTML_CHARS) return false
  const lower = html.toLowerCase()
  if (
    lower.includes('id="root"') ||
    lower.includes("id='root'") ||
    lower.includes('id="app"') ||
    lower.includes("id='app'") ||
    lower.includes('id="__next"') ||
    lower.includes('ng-version=') ||
    /<script[^>]+type=["']module["']/i.test(html)
  ) {
    // Empty shell with a big script budget → likely CSR.
    if (text.length < THIN_HTML_CHARS) return true
  }
  // Markup-heavy, text-light.
  if (html.length > 8_000 && text.length < THIN_HTML_CHARS) return true
  return text.length < 80
}

function basenameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const base = u.pathname.split('/').filter(Boolean).pop() || u.hostname
    return decodeURIComponent(base)
  } catch {
    return url
  }
}

function decodeBody(buf: Buffer, contentType: string): string {
  const charset = contentType.match(/charset=([^\s;]+)/i)?.[1]?.replace(/["']/g, '')
  const enc = (charset || 'utf-8').toLowerCase()
  try {
    return new TextDecoder(enc === 'utf8' ? 'utf-8' : enc).decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}
