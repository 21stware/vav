/**
 * Detect file-path mentions in agent markdown and turn them into clickable
 * links that open the session side preview, with a Finder/Explorer control
 * after each path.
 *
 * Matching rules live in `@shared/filePathMentions` (unit-tested).
 */

import type MarkdownIt from 'markdown-it'
import {
  findFilePathMentions,
  looksLikeFilePath,
  trimPathCandidate
} from '@shared/filePathMentions'
import { tt } from '../i18n/useT'
import { fileManagerLabel } from './platform'
import { joinPath } from './path'

export {
  findFilePathMentions,
  looksLikeFilePath,
  trimPathCandidate
} from '@shared/filePathMentions'
export type { FilePathMention } from '@shared/filePathMentions'

/**
 * Resolve a path mention against the session workdir / home.
 * Absolute paths are returned as-is.
 */
export function resolveMentionedPath(
  raw: string,
  workdir: string | null,
  home: string
): string {
  let path = trimPathCandidate(raw.trim())
  if (!path) return path
  if (path.startsWith('~/') || path === '~') {
    const rest = path === '~' ? '' : path.slice(2)
    path = home ? joinPath(home, rest) : path
    return path
  }
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return path
  if (workdir) return joinPath(workdir, path)
  return path
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Compact folder glyph for the post-link Finder/Explorer control. */
const REVEAL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>'

function revealButtonHtml(path: string): string {
  const title = tt('tools.revealInFm', { fileManager: fileManagerLabel() })
  return (
    `<button type="button" class="md-file-reveal" data-path="${escapeHtml(path)}" ` +
    `title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">` +
    REVEAL_SVG +
    `</button>`
  )
}

/** Path link + Finder control as a single inline unit. */
export function fileMentionHtml(path: string, label: string): string {
  return (
    `<span class="md-file-mention">` +
    `<a class="md-file-link" href="#" data-path="${escapeHtml(path)}" title="${escapeHtml(path)}">` +
    `${escapeHtml(label)}` +
    `</a>` +
    revealButtonHtml(path) +
    `</span>`
  )
}

type MdToken = {
  type: string
  content: string
  children: MdToken[] | null
  attrs: Array<[string, string]> | null
  tag?: string
  nesting?: number
}

/**
 * markdown-it plugin: turn path-like text (and path-like inline code) into
 * path links with a trailing Finder/Explorer button.
 */
export function filePathLinksPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'file_path_links', (state) => {
    const Token = state.Token
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children?.length) continue
      const out: MdToken[] = []
      // Do not rewrite text that is already inside a hyperlink (linkify / MD links).
      let linkDepth = 0
      for (const token of block.children as MdToken[]) {
        if (token.type === 'link_open') linkDepth++
        if (token.type === 'link_close') linkDepth = Math.max(0, linkDepth - 1)
        if (token.type === 'text' && token.content && linkDepth === 0) {
          pushSplitPaths(Token, token.content, out)
          continue
        }
        out.push(token)
      }
      block.children = out as typeof block.children
    }
  })

  const defaultCodeInline =
    md.renderer.rules.code_inline ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

  md.renderer.rules.code_inline = (tokens, idx, options, env, self): string => {
    const content = tokens[idx]?.content ?? ''
    if (looksLikeFilePath(content)) {
      const path = trimPathCandidate(content)
      return `<code class="md-file-code">${fileMentionHtml(path, content)}</code>`
    }
    return defaultCodeInline(tokens, idx, options, env, self)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pushSplitPaths(Token: any, text: string, out: MdToken[]): void {
  const mentions = findFilePathMentions(text)
  if (mentions.length === 0) {
    const t = new Token('text', '', 0)
    t.content = text
    out.push(t)
    return
  }
  let last = 0
  for (const mention of mentions) {
    if (mention.index > last) {
      const t = new Token('text', '', 0)
      t.content = text.slice(last, mention.index)
      out.push(t)
    }
    const html = new Token('html_inline', '', 0)
    html.content = fileMentionHtml(mention.path, mention.path)
    out.push(html)
    last = mention.index + mention.raw.length
  }
  if (last < text.length) {
    const t = new Token('text', '', 0)
    t.content = text.slice(last)
    out.push(t)
  }
}
