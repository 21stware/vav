/**
 * Pure file-path mention detection for agent markdown.
 *
 * Kept free of renderer / DOM / i18n imports so regression tests can run under
 * plain `node --test` without stubbing the Electron UI.
 */

/** Extensions that strongly suggest a file when the string is a real path. */
const FILE_EXTS =
  'ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx|txt|log|csv|tsv|yml|yaml|toml|xml|html|css|scss|less|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|fish|sql|graphql|proto|env|ini|cfg|conf|lock|svg|png|jpg|jpeg|gif|webp|pdf|docx|xlsx|pptx|ipynb|vue|svelte|astro|zig|lua|r|R|dart|scala|clj|ex|exs|erl|hs|ml|mli|nim|v|sv|vhd|asm|s|makefile|dockerfile|gitignore|editorconfig'

/**
 * Characters that end a path mention even when adjacent (no space).
 * Includes ASCII wrappers plus CJK / fullwidth / smart-quote punctuation so
 * prose like `/pæl/，意思…` or `/pɔːl/）发音…` cannot swallow the sentence.
 */
const PATH_END_CHARS =
  '\\s`\'"<>|)\\]\\u2018-\\u201F，。！？、；：…·—～（）【】《》「」『』＜＞'

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
 * `最大化/还原面板` does not treat `/还原面板` as an absolute path.
 *
 * Absolute `/` uses `/(?!/)` so `https://example.io` never yields `//example.io`
 * (protocol-relative host) as a fake Unix path.
 */
const PATH_GLOBAL_SOURCE = [
  // Also exclude `:` so `https://…` cannot match at the `//`.
  '(?<![\\p{L}\\p{N}_./\\\\:-])(',
  // Absolute, home, or explicit relative (`/` but not `//host`)
  '(?:~/|/(?!/)|\\./|\\.\\./|[A-Za-z]:[\\\\/])',
  '[^' + PATH_END_CHARS + ']+',
  '|',
  // dir/…/file.ext (must contain /)
  '(?:[\\w.+-]+/)+[\\w.+-]+\\.(?:' + FILE_EXTS + ')\\b',
  ')'
].join('')

const INLINE_PATH = new RegExp(
  [
    '^(?:',
    '(?:~/|/(?!/)|\\./|\\.\\./|[A-Za-z]:[\\\\/])[^' + PATH_END_CHARS + ']+',
    '|',
    '(?:[\\w.+-]+/)+[\\w.+-]+\\.(?:' + FILE_EXTS + ')',
    ')$'
  ].join(''),
  'iu'
)

/** `example.io/docs/readme.md` — host-shaped, not a workspace path. */
const HOST_RELATIVE =
  /^(?:www\.)?(?:[a-z0-9-]+\.)+(?:[a-z]{2,})(?:[/:?#]|$)/i

/** CJK / fullwidth punctuation that never belongs inside a path mention. */
const PATH_INLINE_PUNCT = /[，。！？、；：…·—～（）【】《》「」『』＜＞\u2018-\u201F]/

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
  if (PATH_INLINE_PUNCT.test(v)) return false
  // Lone `/词` or `/词/` (IPA, CJK particles) — prose, not a path.
  // Optional trailing slash covers phonetic wrappers like `/pæl/`.
  if (/^\/[^/\s.]+\/?$/.test(v) && /[^\u0000-\u007F]/.test(v)) return false
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

export type FilePathMention = {
  /** Trimmed path used for linking / resolve. */
  path: string
  /** Raw matched substring (pre-trim) in the source text. */
  raw: string
  /** Start index of `raw` within the source text. */
  index: number
}

/**
 * Scan plain text for path mentions that should become file links.
 * Fresh regex each call so concurrent scans do not share `lastIndex`.
 */
export function findFilePathMentions(text: string): FilePathMention[] {
  const re = new RegExp(PATH_GLOBAL_SOURCE, 'giu')
  const out: FilePathMention[] = []
  let match: RegExpExecArray | null
  let last = 0
  while ((match = re.exec(text)) !== null) {
    const full = match[1] ?? ''
    const path = trimPathCandidate(full)
    if (!path || !looksLikeFilePath(path)) continue
    const index = match.index + match[0].lastIndexOf(full)
    if (index < last) continue
    out.push({ path, raw: full, index })
    last = index + full.length
    re.lastIndex = last
  }
  return out
}
