/**
 * Composer mention tokens.
 *
 * Pills are a visual layer; the draft holds a short placeholder:
 *   - apps  → `@[App Name]`, sent as-is (resolved via computer_list)
 *   - files → `@file[basename]`, expanded to the real path on send
 *
 * File tokens keep a path map so the textarea stays compact (thumb + name)
 * instead of reserving the full path's glyph width.
 */
import { basename } from '../../lib/path'

/** Matches an app placeholder like `@[Google Chrome]`. */
export const APP_TOKEN_RE = /@\[[^\]\n]+\]/g

/** Matches a file placeholder like `@file[IMG_1555.JPG]`. */
export const FILE_TOKEN_RE = /@file\[[^\]\n]+\]/g

const fileTokenPaths = new Map<string, string>()

/** Build the inline placeholder for an app mention. */
export function appMentionToken(name: string): string {
  const clean = name
    .replace(/[[\]\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `@[${clean}]`
}

/** Extract the app name from a `@[Name]` token, or null. */
export function appNameFromToken(token: string): string | null {
  const m = /^@\[([^\]\n]+)\]$/.exec(token)
  return m ? m[1]! : null
}

function cleanFileLabel(name: string): string {
  return name.replace(/[[\]\n]/g, '_').trim() || 'file'
}

/** Register `path` and return a compact `@file[basename]` token. */
export function fileMentionToken(path: string): string {
  const base = cleanFileLabel(basename(path) || path)
  let label = base
  let n = 2
  let token = `@file[${label}]`
  while (fileTokenPaths.has(token) && fileTokenPaths.get(token) !== path) {
    const dot = base.lastIndexOf('.')
    label = dot > 0 ? `${base.slice(0, dot)} ${n}${base.slice(dot)}` : `${base} ${n}`
    token = `@file[${label}]`
    n++
  }
  fileTokenPaths.set(token, path)
  return token
}

/** Look up the real path for a `@file[…]` token. */
export function pathFromFileToken(token: string): string | null {
  return fileTokenPaths.get(token) ?? null
}

/** Replace file tokens with the registered paths (unknown tokens stay as-is). */
export function expandFileMentionTokens(text: string): string {
  return text.replace(FILE_TOKEN_RE, (token) => fileTokenPaths.get(token) ?? token)
}

/** Paths registered by file tokens in `text`, in document order. */
export function collectFileMentionPaths(text: string): string[] {
  const paths: string[] = []
  const re = new RegExp(FILE_TOKEN_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const path = fileTokenPaths.get(m[0])
    if (path) paths.push(path)
  }
  return paths
}

export type ComposerPillKind = 'file' | 'app'

export type ComposerPill = {
  start: number
  end: number
  /** Human label (file path or app name). */
  name: string
  kind: ComposerPillKind
}

/**
 * Find every inline pill in the draft: explicit `@file[…]` tokens and
 * `@[App]` placeholders. Typed paths (`/compact`, `./src/app.ts`) stay
 * plain text — auto-pilling them ate slash commands and other `/…` input.
 * Ranges are sorted and non-overlapping (earlier match wins).
 */
export function findComposerPills(text: string): ComposerPill[] {
  const pills: ComposerPill[] = []

  const fileRe = new RegExp(FILE_TOKEN_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = fileRe.exec(text)) !== null) {
    const token = m[0]
    const label = token.slice('@file['.length, -1)
    pills.push({
      start: m.index,
      end: m.index + token.length,
      name: pathFromFileToken(token) ?? label,
      kind: 'file'
    })
  }

  const appRe = new RegExp(APP_TOKEN_RE.source, 'g')
  while ((m = appRe.exec(text)) !== null) {
    pills.push({
      start: m.index,
      end: m.index + m[0].length,
      name: appNameFromToken(m[0]) ?? m[0],
      kind: 'app'
    })
  }

  pills.sort((a, b) => a.start - b.start)
  const out: ComposerPill[] = []
  let cursor = 0
  for (const pill of pills) {
    if (pill.start < cursor) continue // drop overlaps
    out.push(pill)
    cursor = pill.end
  }
  return out
}
