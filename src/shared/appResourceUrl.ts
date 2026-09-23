/**
 * Internal URLs for anything the app column can list or preview.
 *
 *   vav://app/storage?path=/abs/file.md
 *   vav://app/storage?path=/abs/folder&dir=1
 *   vav://app/data?id=<conversationId>
 *   vav://app/data?path=/abs/notes.db
 *   vav://app/knowledge?id=<hostId>
 *   vav://app/knowledge?path=/abs/doc.pdf
 *   vav://app/scheduled?id=<conversationId>
 *   vav://app                    — catalog of kinds
 */
import { APP_CATALOG_IDS, isAppResourceKind, type AppResourceKind } from './appPlugins.ts'

export const APP_RESOURCE_SCHEME = 'vav'
export const APP_RESOURCE_HOST = 'app'

export const APP_RESOURCE_KINDS = APP_CATALOG_IDS
export type { AppResourceKind }
export { isAppResourceKind }

export type AppResourceRef = {
  kind: AppResourceKind
  /** Conversation id (data / scheduled) or knowledge host id. */
  id?: string
  path?: string
  dir?: boolean
}

export function isAppResourceUrl(raw: string | null | undefined): boolean {
  return parseAppResourceUrl(raw) !== null || isAppCatalogUrl(raw)
}

/** Bare catalog: `vav://app` or `vav://app/`. */
export function isAppCatalogUrl(raw: string | null | undefined): boolean {
  const parsed = parseAppUrl(raw)
  return !!parsed && parsed.kind === null
}

function parseAppUrl(raw: string | null | undefined): {
  kind: AppResourceKind | null
  search: URLSearchParams
} | null {
  const text = raw?.trim() ?? ''
  if (!text) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== `${APP_RESOURCE_SCHEME}:`) return null
  if (url.hostname !== APP_RESOURCE_HOST && url.host !== APP_RESOURCE_HOST) return null
  const kind = url.pathname.replace(/^\/+|\/+$/g, '')
  if (!kind) return { kind: null, search: url.searchParams }
  if (!isAppResourceKind(kind)) return null
  return { kind, search: url.searchParams }
}

export function parseAppResourceUrl(raw: string | null | undefined): AppResourceRef | null {
  const parsed = parseAppUrl(raw)
  if (!parsed?.kind) return null
  const path = parsed.search.get('path')?.trim() || undefined
  const id = parsed.search.get('id')?.trim() || undefined
  const dir = parsed.search.get('dir') === '1' || parsed.search.get('dir') === 'true'
  if (!path && !id && parsed.kind !== 'storage' && parsed.kind !== 'data' && parsed.kind !== 'knowledge') {
    return { kind: parsed.kind }
  }
  return {
    kind: parsed.kind,
    ...(id ? { id } : {}),
    ...(path ? { path } : {}),
    ...(dir ? { dir: true } : {})
  }
}

export function formatAppResourceUrl(ref: AppResourceRef): string {
  const params = new URLSearchParams()
  if (ref.id) params.set('id', ref.id)
  if (ref.path) params.set('path', ref.path)
  if (ref.dir) params.set('dir', '1')
  const query = params.toString()
  return query
    ? `${APP_RESOURCE_SCHEME}://${APP_RESOURCE_HOST}/${ref.kind}?${query}`
    : `${APP_RESOURCE_SCHEME}://${APP_RESOURCE_HOST}/${ref.kind}`
}

export function formatAppCatalogUrl(): string {
  return `${APP_RESOURCE_SCHEME}://${APP_RESOURCE_HOST}`
}

export function appSearchPrompt(kind: string, query: string): string {
  const q = query.trim()
  const label = kind.trim() || 'app'
  return [
    `Search ${label} for: ${q}`,
    '',
    'Use the `app` tool (`op: "search"` or `op: "list"`) and return matching items with their `vav://app/…` URLs.'
  ].join('\n')
}

export type OpenInAppPlan =
  | { action: 'catalog'; mode?: AppResourceKind }
  | { action: 'browse-folder'; path: string }
  | { action: 'open-file'; path: string }
  | { action: 'focus-object'; id: string; mode: AppResourceKind }
  | { action: 'overlay'; path: string }
  | { action: 'invalid' }

export function planOpenInApp(input: {
  raw: string
  resolvedPath?: string
  isDirectory?: boolean
  isOverlay?: boolean
  objectId?: string | null
}): OpenInAppPlan {
  const raw = input.raw.trim()
  if (!raw) return { action: 'invalid' }
  if (isAppCatalogUrl(raw)) return { action: 'catalog' }
  const ref = parseAppResourceUrl(raw)
  if (ref) {
    if (ref.id || input.objectId) {
      return { action: 'focus-object', id: (ref.id || input.objectId)!, mode: ref.kind }
    }
    if (ref.dir && ref.path) return { action: 'browse-folder', path: ref.path }
    if (ref.path) return { action: 'open-file', path: ref.path }
    return { action: 'catalog', mode: ref.kind }
  }
  const path = input.resolvedPath?.trim() || raw
  if (!path) return { action: 'invalid' }
  if (input.isOverlay) return { action: 'overlay', path }
  if (input.isDirectory) return { action: 'browse-folder', path }
  if (input.objectId) {
    return { action: 'focus-object', id: input.objectId, mode: 'storage' }
  }
  return { action: 'open-file', path }
}

/** Scan markdown / tool output for `vav://app/…` mentions. */
export function findAppResourceUrls(text: string): Array<{ url: string; index: number }> {
  const re = /vav:\/\/app(?:\/[a-z]+)?(?:\?[^\s<>'")\]]*)?/gi
  const out: Array<{ url: string; index: number }> = []
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const url = match[0].replace(/[.,;:!?]+$/, '')
    if (!isAppResourceUrl(url) && !isAppCatalogUrl(url)) continue
    out.push({ url, index: match.index })
  }
  return out
}
