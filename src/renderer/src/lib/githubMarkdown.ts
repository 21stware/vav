import MarkdownIt from 'markdown-it'
import { renderGithubDetails, renderGithubTables, stripHtmlComments } from '@shared/githubDetails'
import { suggestedFilenameForLang } from './markdown'
import { highlightFence } from './hljsLazy'

/**
 * Markdown for GitHub PR bodies. Chat markdown sets `html: false` (model
 * output); Dependabot / release notes ship real HTML (`<details>`, `<h2>`).
 * File-path mention rewriting is off — those glyphs were wrapping hrefs.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  highlight(code: string, language: string): string {
    return highlightFence(code, language)
  }
})

const defaultFence =
  md.renderer.rules.fence ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.fence = (tokens, idx, options, env, self): string => {
  const token = tokens[idx]!
  const info = (token.info || '').trim()
  const language = (info.split(/\s+/g)[0] ?? '').toLowerCase()
  const inner = defaultFence(tokens, idx, options, env, self)
  const filename = suggestedFilenameForLang(language || 'text')
  return (
    `<div class="md-block md-preview-fence" data-kind="code" data-filename="${escapeHtml(filename)}">` +
    `<div class="md-block-bar">` +
    `<span class="md-block-name">${escapeHtml(language || 'code')}</span>` +
    `</div>${inner}</div>`
  )
}

md.renderer.rules.table_open = (): string => `<div class="table-scroll"><table>`
md.renderer.rules.table_close = (): string => `</table></div>`

/** GFM task lists: `- [ ]` / `- [x]` → checkbox, not literal brackets. */
function taskListsPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'github-task-lists', (state) => {
    const tokens = state.tokens
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i]
      if (inline.type !== 'inline' || !inline.children?.length) continue
      const para = tokens[i - 1]
      const item = tokens[i - 2]
      if (para?.type !== 'paragraph_open' || item?.type !== 'list_item_open') continue
      const first = inline.children.find((child) => child.type === 'text' && child.content)
      if (!first) continue
      const match = /^\s*\[([ xX])\][ \t]+/.exec(first.content)
      if (!match) continue
      const checked = match[1] !== ' '
      first.content = first.content.slice(match[0].length)
      inline.content = inline.content.replace(/^\s*\[[ xX]\][ \t]+/, '')
      item.attrJoin('class', 'task-list-item')
      for (let j = i - 3; j >= 0; j--) {
        if (tokens[j]!.type === 'bullet_list_open') {
          tokens[j]!.attrJoin('class', 'contains-task-list')
          break
        }
        if (tokens[j]!.type === 'bullet_list_close' || tokens[j]!.type === 'ordered_list_open') {
          break
        }
      }
      const box = new state.Token('html_inline', '', 0)
      box.content = checked
        ? '<input type="checkbox" class="task-list-item-checkbox" checked disabled />'
        : '<input type="checkbox" class="task-list-item-checkbox" disabled />'
      inline.children.unshift(box)
    }
  })
}

md.use(taskListsPlugin)

const ALLOWED = new Set([
  'A',
  'ABBR',
  'B',
  'BLOCKQUOTE',
  'BR',
  'CODE',
  'DD',
  'DEL',
  'DETAILS',
  'DIV',
  'DL',
  'DT',
  'EM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'I',
  'IMG',
  'INS',
  'KBD',
  'LI',
  'OL',
  'P',
  'PRE',
  'Q',
  'S',
  'SAMP',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUMMARY',
  'SUP',
  'TABLE',
  'TBODY',
  'TD',
  'TFOOT',
  'TH',
  'THEAD',
  'TR',
  'U',
  'UL',
  'PICTURE',
  'SOURCE',
  'INPUT'
])

const DROP = new Set([
  'SCRIPT',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'FORM',
  'TEXTAREA',
  'BUTTON',
  'LINK',
  'META',
  'STYLE',
  'BASE',
  'SVG',
  'MATH'
])

const ALLOWED_ATTR = new Set([
  'href',
  'src',
  'alt',
  'title',
  'width',
  'height',
  'colspan',
  'rowspan',
  'open',
  'start',
  'align',
  'target',
  'rel',
  'type',
  'disabled',
  'checked',
  'class',
  'media',
  'srcset'
])

function isSafeUrl(value: string, attr: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (v.startsWith('#') && attr === 'href') return true
  if (/^(javascript|vbscript|data):/i.test(v)) return false
  if (attr === 'href') return /^(https?:|mailto:)/i.test(v)
  if (attr === 'src') return /^https?:\/\//i.test(v)
  if (attr === 'srcset') {
    return v.split(',').every((part) => {
      const url = (part.trim().split(/\s+/)[0] ?? '').trim()
      return !url || /^https?:\/\//i.test(url)
    })
  }
  return false
}

function sanitizeGithubHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div id="vav-gh-root">${html}</div>`, 'text/html')
  const root = doc.getElementById('vav-gh-root')
  if (!root) return ''

  const walk = (parent: Element): void => {
    for (const el of [...parent.children]) {
      if (DROP.has(el.tagName)) {
        el.remove()
        continue
      }
      if (el.tagName === 'INPUT') {
        const type = (el.getAttribute('type') || '').toLowerCase()
        if (type !== 'checkbox') {
          el.remove()
          continue
        }
        el.setAttribute('type', 'checkbox')
        el.setAttribute('disabled', '')
        const checked = el.hasAttribute('checked')
        for (const attr of [...el.attributes]) {
          const name = attr.name.toLowerCase()
          if (name !== 'type' && name !== 'disabled' && name !== 'checked' && name !== 'class') {
            el.removeAttribute(attr.name)
          }
        }
        if (checked) el.setAttribute('checked', '')
        const cls = el.getAttribute('class') || ''
        if (!/\btask-list-item-checkbox\b/.test(cls)) {
          el.setAttribute('class', 'task-list-item-checkbox')
        }
        continue
      }
      if (!ALLOWED.has(el.tagName)) {
        const frag = doc.createDocumentFragment()
        while (el.firstChild) frag.appendChild(el.firstChild)
        el.replaceWith(frag)
        walk(parent)
        return
      }
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase()
        if (name.startsWith('on') || !ALLOWED_ATTR.has(name)) {
          el.removeAttribute(attr.name)
          continue
        }
        if ((name === 'href' || name === 'src' || name === 'srcset') && !isSafeUrl(attr.value, name)) {
          el.removeAttribute(attr.name)
          continue
        }
        if (name === 'target' && attr.value !== '_blank') {
          el.removeAttribute(attr.name)
        }
      }
      if (el.tagName === 'A' && el.getAttribute('target') === '_blank') {
        el.setAttribute('rel', 'noopener noreferrer')
      }
      walk(el)
    }
  }

  walk(root)
  return root.innerHTML
}

const cache = new Map<string, string>()
const CACHE_LIMIT = 200

export function renderGithubMarkdown(source: string): string {
  const hit = cache.get(source)
  if (hit !== undefined) return hit
  try {
    const prepared = stripHtmlComments(source)
    const html = sanitizeGithubHtml(
      renderGithubTables(prepared, (src) => renderGithubDetails(src, (inner) => md.render(inner)))
    )
    if (cache.size >= CACHE_LIMIT) cache.clear()
    cache.set(source, html)
    return html
  } catch {
    return ''
  }
}
