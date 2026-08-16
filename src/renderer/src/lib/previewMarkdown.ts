import MarkdownIt from 'markdown-it'
import { suggestedFilenameForLang } from './markdown'
import { diagramKindForLang, renderDiagramFence } from './diagramRender'
import { isHtmlClipLang, isXstateLang, renderHtmlClipFence, renderXstateFence } from './htmlClipRender'
import { dirname, joinPath } from './path'
import { highlightFence } from './hljsLazy'
import { mdBlockActionButtons } from './mdBlockActions'

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
  typographer: true,
  highlight(code: string, language: string): string {
    return highlightFence(code, language)
  }
})

const previewDefaultFence =
  previewMd.renderer.rules.fence ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

/** Document fences: language label + copy chrome (quieter than chat). */
function previewFenceChrome(filename: string): string {
  return (
    `<div class="md-block md-preview-fence" data-kind="code" data-filename="${escapeHtml(filename)}">` +
    `<div class="md-block-bar">` +
    `${mdBlockActionButtons('source')}</div>`
  )
}

previewMd.renderer.rules.fence = (tokens, idx, options, env, self): string => {
  const token = tokens[idx]!
  const info = (token.info || '').trim()
  const language = (info.split(/\s+/g)[0] ?? '').toLowerCase()
  const diagram = diagramKindForLang(language)
  if (diagram) return renderDiagramFence(diagram, token.content)
  if (isXstateLang(language)) return renderXstateFence(token.content)
  if (isHtmlClipLang(language)) return renderHtmlClipFence(token.content)
  const inner = previewDefaultFence(tokens, idx, options, env, self)
  const filename = suggestedFilenameForLang(language || 'text')
  return `${previewFenceChrome(filename)}${inner}</div>`
}

previewMd.renderer.rules.table_open = (): string =>
  `<div class="table-scroll md-preview-table"><table>`
previewMd.renderer.rules.table_close = (): string => `</table></div>`

previewMd.renderer.rules.hr = (): string => `<hr class="md-preview-hr" />`

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

/**
 * End index of the last complete markdown block (blank-line separated), never
 * mid-fence. Used to seal progressive preview HTML while the file window grows.
 */
export function findMarkdownSealEnd(source: string, startAt = 0): number {
  if (!source) return 0
  const begin = startAt > 0 && startAt <= source.length ? startAt : 0
  let fence: string | null = null
  let lastSeal = begin
  let lineStart = begin
  for (let i = begin; i <= source.length; i++) {
    const atEnd = i === source.length
    const ch = atEnd ? '\n' : source[i]!
    if (ch !== '\n' && !atEnd) continue
    const line = source.slice(lineStart, i)
    const fenceMatch = /^(```|~~~)/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]!
      if (!fence) fence = marker
      else if (line.startsWith(fence)) fence = null
    } else if (!fence && line === '' && lineStart > 0) {
      // Blank line ends a block — seal after the newline at i.
      lastSeal = Math.min(source.length, i + (atEnd ? 0 : 1))
    }
    lineStart = i + 1
  }
  // Never seal the entire source while it may still grow — keep a live tail.
  if (lastSeal >= source.length) {
    const prev = source.lastIndexOf('\n\n', Math.max(0, source.length - 2))
    return prev >= 0 ? prev + 2 : 0
  }
  return lastSeal
}

export type ProgressivePreviewSeal = {
  filePath: string
  sealedSource: string
  /** Append-only source chunks — each maps to a memoised MarkdownView fragment. */
  sealedChunks: string[]
}

/**
 * Incremental preview markdown: seal completed blocks as immutable source
 * chunks; only the open tail is re-parsed each tick (same model as agent chat
 * streaming). Chunks never rewrite earlier DOM.
 */
export function renderPreviewMarkdownProgressive(
  source: string,
  filePath: string,
  prev: ProgressivePreviewSeal | null
): { sealedChunks: string[]; tail: string; seal: ProgressivePreviewSeal } {
  if (!source) {
    return {
      sealedChunks: [],
      tail: '',
      seal: { filePath, sealedSource: '', sealedChunks: [] }
    }
  }

  const startAt =
    prev && prev.filePath === filePath && source.startsWith(prev.sealedSource)
      ? prev.sealedSource.length
      : 0
  const sealEnd = findMarkdownSealEnd(source, startAt)
  const sealedSource = source.slice(0, sealEnd)
  const tail = source.slice(sealEnd)

  if (
    prev &&
    prev.filePath === filePath &&
    sealedSource.startsWith(prev.sealedSource)
  ) {
    if (sealedSource.length === prev.sealedSource.length) {
      return { sealedChunks: prev.sealedChunks, tail, seal: prev }
    }
    const delta = sealedSource.slice(prev.sealedSource.length)
    const sealedChunks =
      delta.trim().length > 0 ? [...prev.sealedChunks, delta] : prev.sealedChunks
    const seal = { filePath, sealedSource, sealedChunks }
    return { sealedChunks, tail, seal }
  }

  // Reset (path change or mid-doc rewrite): one chunk for the sealed prefix so
  // we don't remount N fragments on a cold open of a large file.
  const sealedChunks = sealedSource.trim().length > 0 ? [sealedSource] : []
  const seal = { filePath, sealedSource, sealedChunks }
  return { sealedChunks, tail, seal }
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
