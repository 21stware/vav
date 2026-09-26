/** Which app-column surface should be mounted. Never both. */
export function appColumnSurface(showingDetail: boolean): 'list' | 'detail' {
  return showingDetail ? 'detail' : 'list'
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
