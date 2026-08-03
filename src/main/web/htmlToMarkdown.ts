/**
 * HTML → readable markdown for agent consumption.
 * Uses Mozilla Readability when a document root is available, then a small
 * tag walker (no turndown dependency).
 *
 * Main process tsconfig has no DOM lib — use structural types + linkedom nodes.
 */

import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

/** Minimal node surface used by the walker (linkedom-compatible). */
interface AnyNode {
  nodeType: number
  textContent: string | null
  childNodes: ArrayLike<AnyNode>
  tagName?: string
  parentElement?: AnyElement | null
  getAttribute?(name: string): string | null
  querySelector?(sel: string): AnyElement | null
  querySelectorAll?(sel: string): ArrayLike<AnyElement>
  children?: ArrayLike<AnyElement>
  remove?(): void
}

interface AnyElement extends AnyNode {
  tagName: string
  className?: string | { toString(): string }
  innerHTML?: string
  getAttribute(name: string): string | null
  querySelector(sel: string): AnyElement | null
  querySelectorAll(sel: string): ArrayLike<AnyElement>
  children: ArrayLike<AnyElement>
}

export interface ExtractedArticle {
  title: string
  byline: string
  excerpt: string
  contentHtml: string
  textContent: string
  siteName: string
  /** true when Readability produced an article; false = whole-body fallback */
  usedReadability: boolean
}

export function extractArticle(html: string, url: string): ExtractedArticle {
  const { document } = parseHTML(html)
  // Base URI helps relative link resolution in some paths; linkedom sets location weakly.
  try {
    Object.defineProperty(document, 'URL', { value: url, configurable: true })
    Object.defineProperty(document, 'documentURI', { value: url, configurable: true })
  } catch {
    /* ignore */
  }

  let usedReadability = false
  let title = ''
  let byline = ''
  let excerpt = ''
  let siteName = ''
  let contentHtml = ''
  let textContent = ''

  try {
    const clone = (document as { cloneNode(deep?: boolean): unknown }).cloneNode(true)
    // Readability expects a DOM Document; linkedom documents are compatible at runtime.
    const article = new Readability(clone as never, {
      charThreshold: 80
    }).parse()
    if (article && (article.textContent?.trim().length ?? 0) >= 80) {
      usedReadability = true
      title = article.title?.trim() || ''
      byline = article.byline?.trim() || ''
      excerpt = article.excerpt?.trim() || ''
      siteName = article.siteName?.trim() || ''
      contentHtml = article.content || ''
      textContent = article.textContent || ''
    }
  } catch {
    // fall through
  }

  if (!usedReadability) {
    // Strip script/style/nav chrome, then take body.
    const doc = document as unknown as {
      body: AnyElement | null
      querySelector(sel: string): AnyElement | null
      querySelectorAll(sel: string): ArrayLike<AnyElement>
    }
    for (const sel of ['script', 'style', 'noscript', 'svg', 'iframe', 'template']) {
      const list = doc.querySelectorAll(sel)
      for (let i = 0; i < list.length; i++) list[i]?.remove?.()
    }
    const body = doc.body
    contentHtml = body?.innerHTML ?? html
    textContent = body?.textContent ?? ''
    title =
      doc.querySelector('title')?.textContent?.trim() ||
      doc.querySelector('h1')?.textContent?.trim() ||
      ''
  }

  return {
    title,
    byline,
    excerpt,
    contentHtml,
    textContent: textContent.replace(/\s+\n/g, '\n').trim(),
    siteName,
    usedReadability
  }
}

export function htmlFragmentToMarkdown(html: string, baseUrl?: string): string {
  if (!html.trim()) return ''
  const { document } = parseHTML(`<div id="__root">${html}</div>`)
  const root = document.querySelector('#__root') as AnyElement | null
  if (!root) return stripTags(html)
  return walkNodes(root.childNodes as ArrayLike<AnyNode>, baseUrl).trim()
}

export function articleToMarkdown(article: ExtractedArticle, baseUrl?: string): string {
  const parts: string[] = []
  if (article.title) parts.push(`# ${escapeMdInline(article.title)}`)
  if (article.byline) parts.push(`*${escapeMdInline(article.byline)}*`)
  if (article.siteName) parts.push(`_${escapeMdInline(article.siteName)}_`)
  if (parts.length) parts.push('')
  const body = htmlFragmentToMarkdown(article.contentHtml, baseUrl)
  if (body) parts.push(body)
  else if (article.textContent) parts.push(article.textContent)
  return parts.join('\n').trim()
}

function walkNodes(nodes: ArrayLike<AnyNode>, baseUrl?: string): string {
  let out = ''
  for (let i = 0; i < nodes.length; i++) {
    out += walkNode(nodes[i]!, baseUrl)
  }
  return out
}

function walkNode(node: AnyNode, baseUrl?: string): string {
  if (node.nodeType === 3 /* TEXT */) {
    return collapseWs(node.textContent ?? '')
  }
  if (node.nodeType !== 1 /* ELEMENT */) return ''

  const el = node as AnyElement
  const tag = el.tagName.toLowerCase()

  if (['script', 'style', 'noscript', 'svg', 'iframe', 'template'].includes(tag)) {
    return ''
  }

  if (tag === 'br') return '\n'
  if (tag === 'hr') return '\n\n---\n\n'

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag[1])
    const text = inlineChildren(el, baseUrl).trim()
    if (!text) return ''
    return `\n\n${'#'.repeat(level)} ${text}\n\n`
  }

  if (tag === 'p') {
    const text = inlineChildren(el, baseUrl).trim()
    return text ? `\n\n${text}\n\n` : ''
  }

  if (tag === 'blockquote') {
    const inner = walkNodes(el.childNodes, baseUrl).trim()
    if (!inner) return ''
    return (
      '\n\n' +
      inner
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n') +
      '\n\n'
    )
  }

  if (tag === 'pre') {
    const code = el.textContent ?? ''
    const codeEl = el.querySelector('code')
    const className = codeEl?.className != null ? String(codeEl.className) : ''
    const lang = className.match(/language-([\w-]+)/)?.[1] ?? ''
    return `\n\n\`\`\`${lang}\n${code.replace(/\n$/, '')}\n\`\`\`\n\n`
  }

  if (tag === 'code') {
    // If parent is pre, handled above.
    if (el.parentElement?.tagName.toLowerCase() === 'pre') {
      return el.textContent ?? ''
    }
    const t = (el.textContent ?? '').replace(/\n/g, ' ')
    return t ? `\`${t.replace(/`/g, '\\`')}\`` : ''
  }

  if (tag === 'a') {
    const href = resolveHref(el.getAttribute('href'), baseUrl)
    const text = inlineChildren(el, baseUrl).trim() || href
    if (!href) return text
    return `[${escapeMdInline(text)}](${href})`
  }

  if (tag === 'img') {
    const src = resolveHref(el.getAttribute('src'), baseUrl)
    const alt = el.getAttribute('alt')?.trim() || 'image'
    if (!src) return ''
    return `![${escapeMdInline(alt)}](${src})`
  }

  if (tag === 'ul' || tag === 'ol') {
    const children = el.children
    const items: AnyElement[] = []
    for (let i = 0; i < children.length; i++) {
      const c = children[i]!
      if (c.tagName.toLowerCase() === 'li') items.push(c)
    }
    let block = '\n\n'
    items.forEach((li, idx) => {
      const bullet = tag === 'ol' ? `${idx + 1}.` : '-'
      const body = walkNodes(li.childNodes, baseUrl).trim().replace(/\n+/g, '\n  ')
      block += `${bullet} ${body}\n`
    })
    return block + '\n'
  }

  if (tag === 'li') {
    return walkNodes(el.childNodes, baseUrl)
  }

  if (tag === 'table') {
    return '\n\n' + tableToMarkdown(el, baseUrl) + '\n\n'
  }

  if (tag === 'strong' || tag === 'b') {
    const t = inlineChildren(el, baseUrl).trim()
    return t ? `**${t}**` : ''
  }
  if (tag === 'em' || tag === 'i') {
    const t = inlineChildren(el, baseUrl).trim()
    return t ? `*${t}*` : ''
  }

  // Generic block vs inline
  if (isBlock(tag)) {
    const inner = walkNodes(el.childNodes, baseUrl).trim()
    return inner ? `\n\n${inner}\n\n` : ''
  }
  return walkNodes(el.childNodes, baseUrl)
}

function inlineChildren(el: AnyElement, baseUrl?: string): string {
  return collapseWs(walkNodes(el.childNodes, baseUrl))
}

function isBlock(tag: string): boolean {
  return [
    'div',
    'section',
    'article',
    'main',
    'header',
    'footer',
    'aside',
    'nav',
    'figure',
    'figcaption',
    'details',
    'summary'
  ].includes(tag)
}

function tableToMarkdown(table: AnyElement, baseUrl?: string): string {
  const rowList = table.querySelectorAll('tr')
  const rows: AnyElement[] = []
  for (let i = 0; i < rowList.length; i++) rows.push(rowList[i]!)
  if (rows.length === 0) return ''
  const matrix = rows.map((row) => {
    const cells = row.querySelectorAll('th,td')
    const cols: string[] = []
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!
      cols.push(escapeMdInline(inlineChildren(cell, baseUrl).trim()).replace(/\|/g, '\\|'))
    }
    return cols
  })
  const width = Math.max(...matrix.map((r) => r.length), 1)
  const norm = matrix.map((r) => {
    const copy = [...r]
    while (copy.length < width) copy.push('')
    return copy
  })
  const header = norm[0]!
  const sep = header.map(() => '---')
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...norm.slice(1).map((r) => `| ${r.join(' | ')} |`)
  ]
  return lines.join('\n')
}

function resolveHref(href: string | null | undefined, baseUrl?: string): string {
  if (!href) return ''
  const h = href.trim()
  if (!h || h.startsWith('#') || h.startsWith('javascript:') || h.startsWith('data:')) return ''
  if (!baseUrl) return h
  try {
    return new URL(h, baseUrl).href
  } catch {
    return h
  }
}

function collapseWs(s: string): string {
  return s.replace(/[ \t\f\v]+/g, ' ')
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeMdInline(s: string): string {
  return s.replace(/([\\`*_[\]{}])/g, '\\$1')
}
