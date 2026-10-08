import { conversationOnMachine } from '@shared/workspaceHost'

/**
 * Which app-column surface should be mounted. `split` keeps the list and shows
 * the focused object beside it (wide column, single click); `detail` is the
 * full layer (double click). List and full detail are never both mounted.
 */
export function appColumnSurface(
  showingDetail: boolean,
  peek = false
): 'list' | 'detail' | 'split' {
  if (showingDetail) return 'detail'
  return peek ? 'split' : 'list'
}

/** App objects that live on the sidebar's current device. */
export function appObjectsOnMachine<T extends { machineId?: string | null }>(
  conversations: readonly T[],
  machineId: string | null | undefined,
  include: (row: T) => boolean
): T[] {
  return conversations.filter((row) => include(row) && conversationOnMachine(row, machineId))
}

/** Recents from the active host; drop leftover rows tagged to another device. */
export function fileSessionsOnMachine<T extends { sessionId: string }>(
  rows: readonly T[],
  conversations: ReadonlyArray<{ id: string; machineId?: string | null }>,
  machineId: string | null | undefined
): T[] {
  const byId = new Map(conversations.map((row) => [row.id, row]))
  return rows.filter((row) => {
    const conversation = byId.get(row.sessionId)
    return !conversation || conversationOnMachine(conversation, machineId)
  })
}

export function knowledgeNoteIdsForPreview(
  hosts: ReadonlyArray<{ id: string; kind: string; conversationId?: string | null }>,
  visibleConversationIds: readonly string[]
): string[] {
  const visible = new Set(visibleConversationIds)
  return hosts
    .filter(
      (host) => host.kind === 'note' && host.conversationId && visible.has(host.conversationId)
    )
    .map((host) => host.id)
}

export function dataRowsNeedingSchema<T extends { id: string; dataFilePath?: string | null }>(
  rows: readonly T[],
  loadedIds: ReadonlySet<string>
): T[] {
  return rows.filter((row) => !!row.dataFilePath && !loadedIds.has(row.id))
}

/** Stable store key so file-session lists do not re-render on unrelated conversation patches. */
export function fileSessionListKey(
  conversations: ReadonlyArray<{ id: string; fileId?: string | null; updatedAt?: number }>
): string {
  return conversations
    .filter((row) => row.fileId)
    .map((row) => `${row.id}:${row.updatedAt ?? 0}`)
    .join('|')
}

export function appObjectListKey<
  T extends {
    id: string
    archived?: boolean
    updatedAt?: number
    title?: string
    sessionKind?: string | null
    dataFilePath?: string | null
    dbConnectionId?: string | null
    knowledgeHostId?: string | null
  }
>(conversations: readonly T[], include: (row: T) => boolean): string {
  return conversations
    .filter(include)
    .map(
      (row) =>
        `${row.id}:${row.updatedAt ?? 0}:${row.title ?? ''}:${row.dataFilePath ?? ''}:${row.dbConnectionId ?? ''}:${row.knowledgeHostId ?? ''}`
    )
    .join('|')
}
