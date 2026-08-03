import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import { renderMermaidFence } from './markdown'
import { dirname, joinPath } from './path'

/**
 * Markdown for trusted local file preview.
 * Unlike agent chat markdown (`html: false`), preview allows inline HTML so
 * README assets (`<picture>`, `<img>`, badges) render, and rewrites relative
 * media URLs against the file’s directory via `vav-local:`.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const previewMd: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  highlight(code: string, language: string): string {
    if (language && hljs.getLanguage(language)) {
      try {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value
      } catch {
        // fall through
      }
    }
    return escapeHtml(code)
  }
})

const previewDefaultFence =
  previewMd.renderer.rules.fence ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

previewMd.renderer.rules.fence = (tokens, idx, options, env, self): string => {
  const token = tokens[idx]!
  const info = (token.info || '').trim()
  const language = (info.split(/\s+/g)[0] ?? '').toLowerCase()
  if (language === 'mermaid') return renderMermaidFence(token.content)
  return previewDefaultFence(tokens, idx, options, env, self)
}

const cache = new Map<string, string>()
const CACHE_LIMIT = 500

export function renderPreviewMarkdown(source: string, filePath: string): string {
  const key = `${filePath}\n${source}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const html = rewriteLocalUrls(previewMd.render(source), dirname(filePath))
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, html)
  return html
}

function rewriteLocalUrls(html: string, baseDir: string): string {
  const doc = new DOMParser().parseFromString(`<div id="vav-md-root">${html}</div>`, 'text/html')
  const root = doc.getElementById('vav-md-root')
  if (!root) return html

  for (const el of root.querySelectorAll<HTMLElement>('[src]')) {
    const next = toLocalUrl(el.getAttribute('src'), baseDir)
    if (next) el.setAttribute('src', next)
  }
  for (const el of root.querySelectorAll<HTMLSourceElement | HTMLImageElement>(
    'source[srcset], img[srcset]'
  )) {
    const srcset = el.getAttribute('srcset')
    if (!srcset) continue
    el.setAttribute('srcset', rewriteSrcset(srcset, baseDir))
  }
  return root.innerHTML
}

function rewriteSrcset(srcset: string, baseDir: string): string {
  return srcset
    .split(',')
    .map((part) => {
      const trimmed = part.trim()
      if (!trimmed) return trimmed
      const [url, ...rest] = trimmed.split(/\s+/)
      const next = toLocalUrl(url, baseDir)
      if (!next) return trimmed
      return [next, ...rest].join(' ')
    })
    .join(', ')
}

function toLocalUrl(url: string | null | undefined, baseDir: string): string | null {
  if (!url || isExternalOrSpecial(url)) return null
  const abs = resolveLocalPath(baseDir, url)
  return abs ? toVavLocal(abs) : null
}

function isExternalOrSpecial(url: string): boolean {
  return (
    /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(url) &&
    !/^file:/i.test(url)
  )
}

function resolveLocalPath(baseDir: string, url: string): string | null {
  try {
    if (/^file:/i.test(url)) {
      const path = decodeURIComponent(url.replace(/^file:\/*/i, '/'))
      return path.startsWith('/') ? path : `/${path}`
    }
    if (url.startsWith('/') || /^[A-Za-z]:[\\/]/.test(url)) return url
    return joinPath(baseDir, url)
  } catch {
    return null
  }
}

function toVavLocal(absPath: string): string {
  return `vav-local://preview/?path=${encodeURIComponent(absPath)}`
}
