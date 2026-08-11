/**
 * Detect file-path mentions in agent markdown and turn them into clickable
 * links that open the session side preview, with a Finder/Explorer control
 * after each path.
 *
 * Only real path shapes — not bare "name.json" / "@scope/pkg" / schema ids
 * (those false-positives as hyperlinks, e.g. vega-lite-spec-v5.json).
 */

import type MarkdownIt from 'markdown-it'
import { tt } from '../i18n/useT'
import { fileManagerLabel } from './platform'
import { joinPath } from './path'

/** Extensions that strongly suggest a file when the string is a real path. */
const FILE_EXTS =
  'ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx|txt|log|csv|tsv|yml|yaml|toml|xml|html|css|scss|less|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|fish|sql|graphql|proto|env|ini|cfg|conf|lock|svg|png|jpg|jpeg|gif|webp|pdf|docx|xlsx|pptx|ipynb|vue|svelte|astro|zig|lua|r|R|dart|scala|clj|ex|exs|erl|hs|ml|mli|nim|v|sv|vhd|asm|s|makefile|dockerfile|gitignore|editorconfig'

/**
 * Match only path-shaped mentions:
 * - absolute Unix / Windows
 * - ~/…
 * - ./… or ../…
 * - workspace-relative with at least one directory separator + extension
 *
 * Does NOT match bare `foo.json` or `@vegalite-spec-v5.json`.
 *
 * Lookbehind uses `\p{L}`/`\p{N}` (not ASCII-only) so CJK prose like
 * `最大化/还原面板` does not treat `/还原面板` as an absolute path. Built
 * without unnecessary escapes — the `u` flag rejects things like `` \` ``.
 *
 * Absolute `/` uses `/(?!/)` so `https://example.io` never yields `//example.io`
 * (protocol-relative host) as a fake Unix path.
 */
const PATH_GLOBAL = new RegExp(
  [
    // Also exclude `:` so `https://…` cannot match at the `//`.
    '(?<![\\p{L}\\p{N}_./\\\\:-])(',
    // Absolute, home, or explicit relative (`/` but not `//host`)
    '(?:~/|/(?!/)|\\./|\\.\\./|[A-Za-z]:[\\\\/])',
    '[^\\s`\'"<>|)\\]]+',
    '|',
    // dir/…/file.ext (must contain /)
    '(?:[\\w.+-]+/)+[\\w.+-]+\\.(?:' + FILE_EXTS + ')\\b',
    ')'
  ].join(''),
  'giu'
)

const INLINE_PATH = new RegExp(
  [
    '^(?:',
    '(?:~/|/(?!/)|\\./|\\.\\./|[A-Za-z]:[\\\\/])[^\\s`\'"<>|]+',
    '|',
    '(?:[\\w.+-]+/)+[\\w.+-]+\\.(?:' + FILE_EXTS + ')',
    ')$'
  ].join(''),
  'iu'
)

/** `example.io/docs/readme.md` — host-shaped, not a workspace path. */
const HOST_RELATIVE =
  /^(?:www\.)?(?:[a-z0-9-]+\.)+(?:[a-z]{2,})(?:[/:?#]|$)/i

export function looksLikeFilePath(value: string): boolean {
  const v = value.trim()
  if (!v || v.length < 2 || v.length > 512) return false
  // URLs (incl. protocol-relative `//cdn.example.com/…`)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return false
  if (v.startsWith('//')) return false
  if (v.includes('://')) return false
  if (v.startsWith('mailto:')) return false
  // npm scopes / schema-ish tokens (e.g. @vegalite-spec-v5.json)
  if (v.startsWith('@')) return false
  // Bare filename without a directory — too many false positives (specs, packages).
  if (!/[\\/]/.test(v) && !v.startsWith('~')) return false
  // Lone `/词` with no further slash/extension is almost always prose, not a path
  // (e.g. Chinese "最大化/还原面板" leaking `/还原面板`).
  if (/^\/[^/\s.]+$/.test(v) && /[^\u0000-\u007F]/.test(v)) return false
  // Domain / path shaped (`.io` / `.com` sites without a scheme).
  if (HOST_RELATIVE.test(v)) return false
  return INLINE_PATH.test(v)
}

/** Strip trailing sentence punctuation that is not part of the path. */
export function trimPathCandidate(raw: string): string {
  return raw
    .replace(/[.,;:!?。，；：！？、]+$/g, '')
    .replace(/['")\]】》」』）]+$/g, '')
}

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
  PATH_GLOBAL.lastIndex = 0
  let last = 0
  let match: RegExpExecArray | null
  let any = false
  while ((match = PATH_GLOBAL.exec(text)) !== null) {
    const full = match[1] ?? ''
    const path = trimPathCandidate(full)
    if (!path || !looksLikeFilePath(path)) continue
    const pathStart = match.index + match[0].lastIndexOf(full)
    if (pathStart < last) continue
    any = true
    if (pathStart > last) {
      const t = new Token('text', '', 0)
      t.content = text.slice(last, pathStart)
      out.push(t)
    }
    const html = new Token('html_inline', '', 0)
    html.content = fileMentionHtml(path, path)
    out.push(html)
    last = pathStart + full.length
    PATH_GLOBAL.lastIndex = last
  }
  if (!any) {
    const t = new Token('text', '', 0)
    t.content = text
    out.push(t)
    return
  }
  if (last < text.length) {
    const t = new Token('text', '', 0)
    t.content = text.slice(last)
    out.push(t)
  }
}
