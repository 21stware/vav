import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'

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

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight(code: string, language: string): string {
    if (language && hljs.getLanguage(language)) {
      try {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value
      } catch {
        // Fall through to the escaped default below.
      }
    }
    return escapeHtml(code)
  }
})

/**
 * Tables get their own scroll container.
 *
 * A table narrower than its columns has to give somewhere, and the default —
 * wrapping every cell until the rows are five lines tall — destroys the one
 * thing a table is for. The wrapper lets it keep its column widths and scroll
 * sideways instead.
 */
md.renderer.rules.table_open = (): string => '<div class="table-scroll"><table>'
md.renderer.rules.table_close = (): string => '</table></div>'

const cache = new Map<string, string>()
const CACHE_LIMIT = 2000

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
