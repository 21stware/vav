/**
 * Detect file-path mentions in agent markdown and turn them into compact
 * chips (thumbnail + filename). Click opens a standalone preview window.
 *
 * Matching rules live in `@shared/filePathMentions` (unit-tested).
 */

import type MarkdownIt from 'markdown-it'
import {
  findAppResourceUrls,
  isAppResourceUrl,
  parseAppResourceUrl
} from '@shared/appResourceUrl'
import {
  findFilePathMentions,
  looksLikeFilePath,
  trimPathCandidate
} from '@shared/filePathMentions'
import { localFileStreamUrl } from '@shared/localFileUrl'
import { PREVIEW_IMAGE_EXTS } from '@shared/previewKind'
import { basename, extname, joinPath } from './path'

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

const FILE_GLYPH =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'

/** Visible chip label — basename only; the full path stays on `title`. */
export function fileMentionDisplayName(path: string): string {
  const trimmed = trimPathCandidate(path.trim())
  if (isAppResourceUrl(trimmed)) {
    const ref = parseAppResourceUrl(trimmed)
    if (ref?.path) return basename(ref.path) || ref.path
    if (ref?.id) return ref.id
    return ref?.kind ?? trimmed
  }
  return basename(trimmed) || trimmed
}

export function isFileMentionImage(path: string): boolean {
  return PREVIEW_IMAGE_EXTS.has(extname(path).toLowerCase())
}

function chipThumbHtml(path: string): string {
  if (isFileMentionImage(path) && (/^\/|^[A-Za-z]:[\\/]/.test(path) || path.startsWith('~/'))) {
    const src = escapeHtml(localFileStreamUrl(path))
    return (
      `<img class="md-file-chip-thumb" src="${src}" alt="" draggable="false" ` +
      `onerror="this.hidden=true;const n=this.nextElementSibling;if(n)n.hidden=false"/>` +
      `<span class="md-file-chip-icon" hidden>${FILE_GLYPH}</span>`
    )
  }
  return `<span class="md-file-chip-icon">${FILE_GLYPH}</span>`
}

/** Inline file chip: thumbnail + filename. Full path is the tooltip. */
export function fileMentionHtml(path: string): string {
  const resolved = trimPathCandidate(path)
  const name = fileMentionDisplayName(resolved)
  return (
    `<button type="button" class="md-file-chip" data-path="${escapeHtml(resolved)}" ` +
    `title="${escapeHtml(resolved)}">` +
    chipThumbHtml(resolved) +
    `<span class="md-file-chip-name">${escapeHtml(name)}</span>` +
    `</button>`
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
 * thumbnail + filename chips.
 */
export function filePathLinksPlugin(md: MarkdownIt): void {
  md.core.ruler.after('md_marks', 'file_path_links', (state) => {
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
    if (looksLikeFilePath(content) || isAppResourceUrl(content)) {
      return fileMentionHtml(trimPathCandidate(content))
    }
    return defaultCodeInline(tokens, idx, options, env, self)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pushSplitPaths(Token: any, text: string, out: MdToken[]): void {
  const mentions = [
    ...findFilePathMentions(text).map((mention) => ({
      path: mention.path,
      index: mention.index,
      raw: mention.raw
    })),
    ...findAppResourceUrls(text).map((mention) => ({
      path: mention.url,
      index: mention.index,
      raw: mention.url
    }))
  ].sort((a, b) => a.index - b.index)
  if (mentions.length === 0) {
    const t = new Token('text', '', 0)
    t.content = text
    out.push(t)
    return
  }
  let last = 0
  for (const mention of mentions) {
    if (mention.index < last) continue
    if (mention.index > last) {
      const t = new Token('text', '', 0)
      t.content = text.slice(last, mention.index)
      out.push(t)
    }
    const html = new Token('html_inline', '', 0)
    html.content = fileMentionHtml(mention.path)
    out.push(html)
    last = mention.index + mention.raw.length
  }
  if (last < text.length) {
    const t = new Token('text', '', 0)
    t.content = text.slice(last)
    out.push(t)
  }
}
