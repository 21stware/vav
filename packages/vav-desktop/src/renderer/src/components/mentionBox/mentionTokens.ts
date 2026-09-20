/**
 * Composer mention tokens.
 *
 * Pills are a visual layer; the draft holds a short placeholder:
 *   - apps       → `@[App Name]`, sent as-is (resolved via computer_list)
 *   - files      → `@file[basename]`, expanded to the real path on send
 *   - data       → `@data[title]`, expanded to a path or connection id
 *   - knowledge  → `@knowledge[title]`, expanded to a host id the tools can use
 */
import { basename } from '../../lib/path'

/** Matches an app placeholder like `@[Google Chrome]`. */
export const APP_TOKEN_RE = /@\[[^\]\n]+\]/g

/** Matches a file placeholder like `@file[IMG_1555.JPG]`. */
export const FILE_TOKEN_RE = /@file\[[^\]\n]+\]/g

/** Matches a Data resource placeholder like `@data[sales.csv]`. */
export const DATA_TOKEN_RE = /@data\[[^\]\n]+\]/g

/** Matches a Knowledge host placeholder like `@knowledge[Notes]`. */
export const KNOWLEDGE_TOKEN_RE = /@knowledge\[[^\]\n]+\]/g

const fileTokenPaths = new Map<string, string>()

export type DataMentionRef = {
  conversationId: string
  title: string
  path?: string | null
  connectionId?: string | null
}

export type KnowledgeMentionRef = {
  hostId: string
  title: string
}

const dataTokenRefs = new Map<string, DataMentionRef>()
const knowledgeTokenRefs = new Map<string, KnowledgeMentionRef>()

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

function cleanBracketLabel(name: string, fallback: string): string {
  return name.replace(/[[\]\n]/g, '_').trim() || fallback
}

function uniqueBracketToken<T>(
  prefix: string,
  label: string,
  map: Map<string, T>,
  same: (existing: T) => boolean
): string {
  let next = label
  let n = 2
  let token = `@${prefix}[${next}]`
  while (map.has(token) && !same(map.get(token)!)) {
    const dot = label.lastIndexOf('.')
    next = dot > 0 ? `${label.slice(0, dot)} ${n}${label.slice(dot)}` : `${label} ${n}`
    token = `@${prefix}[${next}]`
    n++
  }
  return token
}

/** Register `path` and return a compact `@file[basename]` token. */
export function fileMentionToken(path: string): string {
  const base = cleanBracketLabel(basename(path) || path, 'file')
  const token = uniqueBracketToken('file', base, fileTokenPaths, (existing) => existing === path)
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

export function dataMentionToken(ref: DataMentionRef): string {
  const base = cleanBracketLabel(ref.title || basename(ref.path || '') || 'data', 'data')
  const token = uniqueBracketToken(
    'data',
    base,
    dataTokenRefs,
    (existing) =>
      existing.conversationId === ref.conversationId &&
      (existing.path || '') === (ref.path || '') &&
      (existing.connectionId || '') === (ref.connectionId || '')
  )
  dataTokenRefs.set(token, ref)
  return token
}

export function knowledgeMentionToken(ref: KnowledgeMentionRef): string {
  const base = cleanBracketLabel(ref.title || 'knowledge', 'knowledge')
  const token = uniqueBracketToken(
    'knowledge',
    base,
    knowledgeTokenRefs,
    (existing) => existing.hostId === ref.hostId
  )
  knowledgeTokenRefs.set(token, ref)
  return token
}

export function expandDataMentionTokens(text: string): string {
  return text.replace(DATA_TOKEN_RE, (token) => {
    const ref = dataTokenRefs.get(token)
    if (!ref) return token
    if (ref.path) return ref.path
    if (ref.connectionId) return `Data "${ref.title}" (connection ${ref.connectionId})`
    return `Data "${ref.title}"`
  })
}

export function expandKnowledgeMentionTokens(text: string): string {
  return text.replace(KNOWLEDGE_TOKEN_RE, (token) => {
    const ref = knowledgeTokenRefs.get(token)
    if (!ref) return token
    return `Knowledge "${ref.title}" (host ${ref.hostId})`
  })
}

export function collectDataMentionPaths(text: string): string[] {
  const paths: string[] = []
  const re = new RegExp(DATA_TOKEN_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const path = dataTokenRefs.get(m[0])?.path
    if (path) paths.push(path)
  }
  return paths
}

export function expandComposerMentionTokens(text: string): string {
  return expandKnowledgeMentionTokens(expandDataMentionTokens(expandFileMentionTokens(text)))
}

export type ComposerPillKind = 'file' | 'app' | 'data' | 'knowledge'

export type ComposerPill = {
  start: number
  end: number
  /** Human label (file path or app / data / knowledge name). */
  name: string
  kind: ComposerPillKind
}

/**
 * Find every inline pill in the draft: `@file` / `@data` / `@knowledge`
 * tokens and `@[App]` placeholders. Typed paths stay plain text.
 * Ranges are sorted and non-overlapping (earlier match wins).
 */
export function findComposerPills(text: string): ComposerPill[] {
  const pills: ComposerPill[] = []

  const push = (
    re: RegExp,
    kind: ComposerPillKind,
    nameOf: (token: string) => string
  ): void => {
    const scan = new RegExp(re.source, 'g')
    let m: RegExpExecArray | null
    while ((m = scan.exec(text)) !== null) {
      pills.push({
        start: m.index,
        end: m.index + m[0].length,
        name: nameOf(m[0]),
        kind
      })
    }
  }

  push(FILE_TOKEN_RE, 'file', (token) => pathFromFileToken(token) ?? token.slice('@file['.length, -1))
  push(DATA_TOKEN_RE, 'data', (token) => dataTokenRefs.get(token)?.title ?? token.slice('@data['.length, -1))
  push(
    KNOWLEDGE_TOKEN_RE,
    'knowledge',
    (token) => knowledgeTokenRefs.get(token)?.title ?? token.slice('@knowledge['.length, -1)
  )
  push(APP_TOKEN_RE, 'app', (token) => appNameFromToken(token) ?? token)

  pills.sort((a, b) => a.start - b.start)
  const out: ComposerPill[] = []
  let cursor = 0
  for (const pill of pills) {
    if (pill.start < cursor) continue
    out.push(pill)
    cursor = pill.end
  }
  return out
}
