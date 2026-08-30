/**
 * markdown-it plugin: TeX → KaTeX, `[web:N]` / `[doc:id]` → cite chips.
 */

import type MarkdownIt from 'markdown-it'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { findMdMarks } from '@shared/mdMarks'
import { tt } from '../i18n/useT'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderMathHtml(tex: string, display: boolean): string {
  const inner = katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    output: 'html',
    strict: 'ignore',
    trust: false
  })
  const cls = display ? 'md-math md-math-display' : 'md-math md-math-inline'
  return `<span class="${cls}">${inner}</span>`
}

function citeHtml(cite: 'web' | 'doc', id: string): string {
  const title =
    cite === 'web' ? tt('md.cite.web', { n: id }) : tt('md.cite.doc', { id })
  const label = cite === 'web' ? id : id.length <= 8 ? id : 'doc'
  return (
    `<button type="button" class="md-cite md-cite-${cite}" ` +
    `data-cite-kind="${cite}" data-cite-id="${escapeHtml(id)}" ` +
    `title="${escapeHtml(title)}">${escapeHtml(label)}</button>`
  )
}

function markHtml(mark: ReturnType<typeof findMdMarks>[number]): string {
  if (mark.kind === 'math') return renderMathHtml(mark.tex, mark.display)
  return citeHtml(mark.cite, mark.id)
}

type MdToken = {
  type: string
  content: string
  children: MdToken[] | null
}

export function mdMarksPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'md_marks', (state) => {
    const Token = state.Token
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children?.length) continue
      const out: MdToken[] = []
      let linkDepth = 0
      for (const token of block.children as MdToken[]) {
        if (token.type === 'link_open') linkDepth++
        if (token.type === 'link_close') linkDepth = Math.max(0, linkDepth - 1)
        if (token.type === 'text' && token.content && linkDepth === 0) {
          pushSplitMarks(Token, token.content, out)
          continue
        }
        out.push(token)
      }
      block.children = out as typeof block.children
    }
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pushSplitMarks(Token: any, text: string, out: MdToken[]): void {
  const marks = findMdMarks(text)
  if (marks.length === 0) {
    const t = new Token('text', '', 0)
    t.content = text
    out.push(t)
    return
  }
  let last = 0
  for (const mark of marks) {
    if (mark.start > last) {
      const t = new Token('text', '', 0)
      t.content = text.slice(last, mark.start)
      out.push(t)
    }
    const html = new Token('html_inline', '', 0)
    html.content = markHtml(mark)
    out.push(html)
    last = mark.end
  }
  if (last < text.length) {
    const t = new Token('text', '', 0)
    t.content = text.slice(last)
    out.push(t)
  }
}

export const REVEAL_CITE_EVENT = 'vav:reveal-cite'
export const EXPAND_PROCESS_EVENT = 'vav:expand-process'

export type RevealCiteDetail = { kind: 'web' | 'doc'; id: string }

/** Expand the matching tool in this turn and flash the hit. */
export function revealCitation(fromEl: HTMLElement, kind: 'web' | 'doc', id: string): void {
  const turn = fromEl.closest('.message-turn')
  if (!turn) return
  const selector =
    kind === 'web'
      ? '[data-tool="web_search"]'
      : '[data-tool="doc_search"], [data-tool="doc_fetch"]'
  const cards = [...turn.querySelectorAll<HTMLElement>(selector)]
  const key = `${kind}:${id}`
  const match =
    cards.find((card) =>
      (card.getAttribute('data-cite-keys') || '').split(/\s+/).includes(key)
    ) ?? cards.at(-1)
  if (!match) return

  const process = match.closest('.thinking-process')
  const wasClosed =
    (process != null && !process.classList.contains('expanded')) ||
    !match.classList.contains('expanded')
  process?.dispatchEvent(new CustomEvent(EXPAND_PROCESS_EVENT))
  match.dispatchEvent(new CustomEvent(REVEAL_CITE_EVENT, { detail: { kind, id } }))

  window.setTimeout(
    () => {
      const hit =
        match.querySelector<HTMLElement>(`[data-cite-anchor="${CSS.escape(key)}"]`) ?? match
      hit.scrollIntoView({ block: 'center' })
      hit.classList.add('cite-flash')
      window.setTimeout(() => hit.classList.remove('cite-flash'), 1500)
    },
    wasClosed ? 200 : 0
  )
}
