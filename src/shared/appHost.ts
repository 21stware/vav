/**
 * App ↔ agent contract. The right-hand column and the model share this plane.
 * Transport (IPC or the session host event) is an adapter — not the protocol.
 */
import {
  isAppResourceKind,
  type AppResourceKind,
  type AppResourceRow
} from './appPlugins.ts'

export type AppHostEventType = 'created' | 'updated' | 'open'

export type AppHostEvent = {
  type: AppHostEventType
  url: string
  kind: AppResourceKind
}

export type AppHostApply = {
  type: 'app-apply'
  event: AppHostEvent
}

const EVENT_TYPES = new Set<AppHostEventType>(['created', 'updated', 'open'])

export function parseAppHostEvent(value: unknown): AppHostEvent | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (!EVENT_TYPES.has(raw.type as AppHostEventType)) return null
  if (typeof raw.url !== 'string' || raw.url.trim().length === 0) return null
  if (!isAppResourceKind(String(raw.kind ?? ''))) return null
  return {
    type: raw.type as AppHostEventType,
    url: raw.url.trim(),
    kind: raw.kind as AppResourceKind
  }
}

export type AppCatalogMutation = {
  content?: string
  title?: string
  path?: string
  prompt?: string
  schedule?: string
  enabled?: boolean
  connectionUrl?: string
  folderId?: string
}

/** Kernel catalog port. Same shape the `app` tool already calls. */
export type AppCatalogHost = {
  list(kind?: AppResourceKind): AppResourceRow[]
  resolve(raw: string): AppResourceRow | null
  read(raw: string): Promise<{ text: string; title: string; url: string } | { error: string }>
  write(
    raw: string,
    content: string,
    extras?: AppCatalogMutation
  ): Promise<{ url: string; title: string } | { error: string }>
  create(
    input: AppCatalogMutation & { kind: AppResourceKind }
  ): Promise<{ url: string; title: string } | { error: string }>
  remove(raw: string): Promise<{ ok: true; url: string } | { error: string }>
  search?(
    raw: string | null,
    query: string
  ): Promise<{ text: string } | { error: string }>
  focusedUrl?(): string | null
}
