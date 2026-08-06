import MarkdownIt from 'markdown-it'
import {
  diagramKindForLang,
  renderDiagramFence,
  decodeDiagramSource
} from './diagramRender'
import { filePathLinksPlugin } from './filePathLinks'
import { highlightFence, onHljsReady } from './hljsLazy'

/**
 * Markdown for agent output.
 *
 * `html: false` matters: message bodies are model-generated, so raw HTML is
 * escaped rather than injected.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const LANG_EXT: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  bash: 'sh',
  shell: 'sh',
  zsh: 'sh',
  sh: 'sh',
  ruby: 'rb',
  rust: 'rs',
  golang: 'go',
  go: 'go',
  csharp: 'cs',
  c: 'c',
  cpp: 'cpp',
  java: 'java',
  kotlin: 'kt',
  swift: 'swift',
  json: 'json',
  yaml: 'yml',
  yml: 'yml',
  toml: 'toml',
  markdown: 'md',
  md: 'md',
  html: 'html',
  css: 'css',
  sql: 'sql',
  xml: 'xml',
  plaintext: 'txt',
  text: 'txt'
}

export function suggestedFilenameForLang(language: string): string {
  const key = language.trim().toLowerCase()
  const ext = LANG_EXT[key] ?? (key && /^[a-z0-9]+$/i.test(key) ? key : 'txt')
  return `snippet.${ext}`
}

function blockChrome(filename: string, kind: 'code' | 'table'): string {
  return (
    `<div class="md-block" data-kind="${kind}" data-filename="${escapeHtml(filename)}">` +
    `<div class="md-block-bar">` +
    `<span class="md-block-name">${escapeHtml(filename)}</span>` +
    `<span class="md-block-actions">` +
    `<button type="button" class="md-block-btn" data-md-action="copy" title="Copy">Copy</button>` +
    `<button type="button" class="md-block-btn" data-md-action="save" title="Save as file">Save as file</button>` +
    `</span></div>`
  )
}

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight(code: string, language: string): string {
    return highlightFence(code, language)
  }
})

// Path mentions → clickable file links (open preview).
md.use(filePathLinksPlugin)

const defaultFence =
  md.renderer.rules.fence ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.fence = (tokens, idx, options, env, self): string => {
  const token = tokens[idx]!
  const info = (token.info || '').trim()
  const language = (info.split(/\s+/g)[0] ?? '').toLowerCase()
  const diagram = diagramKindForLang(language)
  if (diagram) {
    return renderDiagramFence(diagram, token.content)
  }
  const filename = suggestedFilenameForLang(language)
  const inner = defaultFence(tokens, idx, options, env, self)
  return `${blockChrome(filename, 'code')}${inner}</div>`
}

/** @deprecated use renderDiagramFence('mermaid', source) */
export function renderMermaidFence(source: string): string {
  return renderDiagramFence('mermaid', source)
}

/**
 * Tables get their own scroll container plus the shared Copy / Save chrome.
 */
md.renderer.rules.table_open = (): string =>
  `${blockChrome('table.csv', 'table')}<div class="table-scroll"><table>`
md.renderer.rules.table_close = (): string => '</table></div></div>'

const cache = new Map<string, string>()
const CACHE_LIMIT = 2000

// When highlight.js arrives, drop sealed HTML so the next paint gets real spans.
onHljsReady(() => cache.clear())

/** Renders and memoises. Sealed chunks are stable strings, so this always hits. */
export function renderMarkdown(source: string): string {
  const hit = cache.get(source)
  if (hit !== undefined) return hit
  const html = md.render(source)
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(source, html)
  return html
}

/** Renders without caching, for the open tail that changes every tick. */
export function renderMarkdownUncached(source: string): string {
  return md.render(source)
}

/**
 * Wraps search matches in <mark> by walking text nodes.
 *
 * Done on the DOM rather than the HTML string so a match can never break
 * markup, and so code highlighting stays intact.
 */
export function highlightMatches(container: HTMLElement, query: string): void {
  if (!query.trim()) return
  const needle = query.toLowerCase()
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []

  let node = walker.nextNode()
  while (node) {
    if (node.textContent && node.textContent.toLowerCase().includes(needle)) {
      targets.push(node as Text)
    }
    node = walker.nextNode()
  }

  for (const text of targets) {
    const value = text.textContent ?? ''
    const fragment = document.createDocumentFragment()
    let cursor = 0
    let index = value.toLowerCase().indexOf(needle, cursor)
    while (index >= 0) {
      if (index > cursor) fragment.appendChild(document.createTextNode(value.slice(cursor, index)))
      const mark = document.createElement('mark')
      mark.textContent = value.slice(index, index + query.length)
      fragment.appendChild(mark)
      cursor = index + query.length
      index = value.toLowerCase().indexOf(needle, cursor)
    }
    if (cursor < value.length) fragment.appendChild(document.createTextNode(value.slice(cursor)))
    text.parentNode?.replaceChild(fragment, text)
  }
}

/** Plain text for Copy / Save — diagram source, code fence body, or table→CSV. */
export function extractBlockPlainText(block: HTMLElement): string {
  const kind = block.dataset.kind
  if (kind === 'mermaid' || kind === 'graphviz' || kind === 'vegalite' || kind === 'erd') {
    const b64 =
      block.dataset.diagramB64 ||
      block.dataset.mermaidB64 ||
      block.querySelector('.md-diagram, .md-mermaid')?.getAttribute('data-b64') ||
      ''
    if (b64) {
      const decoded = decodeDiagramSource(b64)
      if (decoded) return decoded
    }
    return (
      block.querySelector('.md-diagram-fallback, .md-mermaid-fallback')?.textContent || ''
    )
  }
  if (kind === 'table') {
    const table = block.querySelector('table')
    if (!table) return ''
    return [...table.querySelectorAll('tr')]
      .map((row) =>
        [...row.querySelectorAll('th,td')]
          .map((cell) => csvEscape(cell.textContent ?? ''))
          .join(',')
      )
      .join('\n')
  }
  const code = block.querySelector('pre code') ?? block.querySelector('pre')
  return code?.textContent ?? ''
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}
