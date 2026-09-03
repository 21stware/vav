/**
 * Merge a listMeta broadcast into the local sidebar without reordering on
 * view-only / metadata-only updates. Recency sort applies only when some
 * conversation's `updatedAt` (or pin/archive membership) actually changed.
 *
 * Selecting a session or focusing a file must not reshuffle the list —
 * only real conversation activity (messages) bumps `updatedAt` on main.
 */

import { regenerateActiveLeaf } from '../../../shared/thread.ts'

export { regenerateActiveLeaf }

export type ConversationListItem = {
  id: string
  updatedAt: number
  pinned: boolean
  pinTime: number | null
  archived: boolean
  archivedAt: number | null
  fileId?: string | null
}

/** Optimistic one-row patch; file-preview sessions stay in the local list. */
export function patchConversationById<C extends { id: string }>(
  conversations: C[],
  id: string,
  patch: Partial<C> | ((conversation: C) => C)
): C[] {
  return conversations.map((c) => {
    if (c.id !== id) return c
    return typeof patch === 'function' ? patch(c) : { ...c, ...patch }
  })
}

/** Prepend a hydrated/duplicated session; keep the list if the id is already there. */
export function prependConversationIfMissing<C extends { id: string }>(
  conversations: C[],
  meta: C
): C[] {
  return conversations.some((c) => c.id === meta.id) ? conversations : [meta, ...conversations]
}

/** Sidebar ids for shift-range select: archive vs live, never file-preview rows. */
export function listedConversationIdsForSelect(
  conversations: Array<{ id: string; archived?: boolean; fileId?: string | null }>,
  archived: boolean | undefined
): string[] {
  return conversations
    .filter((c) => (archived ? c.archived && !c.fileId : !c.archived && !c.fileId))
    .map((c) => c.id)
}

/** File-preview sessions are hidden from listMeta — hydrate maps on demand. */
export function fileSessionHydrateOnDemandPatch<C extends { id: string }, M, Comp, Hist>(
  state: {
    conversations: C[]
    messages: Record<string, M>
    messagesHydrated: Record<string, boolean>
    activeLeaf: Record<string, string | null>
    compactions: Record<string, Comp>
    tokenHistories: Record<string, Hist>
    cacheExpiresAt: Record<string, number | null>
  },
  id: string,
  payload: {
    meta: C
    messages: M
    activeLeafId: string | null
    compactions?: Comp | null
    tokenHistory?: Hist | null
    cacheExpiresAt?: number | null
  }
): {
  conversations: C[]
  messages: Record<string, M>
  messagesHydrated: Record<string, boolean>
  activeLeaf: Record<string, string | null>
  compactions: Record<string, Comp>
  tokenHistories: Record<string, Hist>
  cacheExpiresAt: Record<string, number | null>
} {
  return {
    conversations: prependConversationIfMissing(state.conversations, payload.meta),
    messages: { ...state.messages, [id]: payload.messages },
    messagesHydrated: { ...state.messagesHydrated, [id]: true },
    activeLeaf: { ...state.activeLeaf, [id]: payload.activeLeafId },
    compactions: { ...state.compactions, [id]: payload.compactions ?? ([] as Comp) },
    tokenHistories: { ...state.tokenHistories, [id]: payload.tokenHistory ?? ([] as Hist) },
    cacheExpiresAt: { ...state.cacheExpiresAt, [id]: payload.cacheExpiresAt ?? null }
  }
}

/** After deleting a turn, stamp the surviving tree and mark it hydrated. */
export function deleteMessageHydratePatch<C extends ConversationListItem, M>(
  state: {
    conversations: C[]
    messages: Record<string, M>
    messagesHydrated: Record<string, boolean>
    activeLeaf: Record<string, string | null>
  },
  activeId: string,
  result: {
    conversations: C[]
    messages: M
    activeLeafId: string | null
  }
): {
  conversations: C[]
  messages: Record<string, M>
  messagesHydrated: Record<string, boolean>
  activeLeaf: Record<string, string | null>
} {
  return {
    conversations: mergeConversationList(state.conversations, result.conversations),
    messages: { ...state.messages, [activeId]: result.messages },
    messagesHydrated: { ...state.messagesHydrated, [activeId]: true },
    activeLeaf: { ...state.activeLeaf, [activeId]: result.activeLeafId }
  }
}

/** Claim/open: merge meta when the id exists, else prepend. */
export function upsertConversationMeta<C extends { id: string }>(
  conversations: C[],
  meta: C
): C[] {
  return conversations.some((c) => c.id === meta.id)
    ? conversations.map((c) => (c.id === meta.id ? { ...c, ...meta } : c))
    : [meta, ...conversations]
}

export function mergeConversationList<T extends ConversationListItem>(
  prev: T[],
  next: T[]
): T[] {
  const prevIndex = new Map(prev.map((c, i) => [c.id, i]))
  const prevById = new Map(prev.map((c) => [c.id, c]))
  const nextById = new Map(next.map((c) => [c.id, c]))

  let orderRelevantChange = false
  for (const n of next) {
    const p = prevById.get(n.id)
    if (!p) {
      orderRelevantChange = true
      break
    }
    if (
      p.updatedAt !== n.updatedAt ||
      p.pinned !== n.pinned ||
      p.pinTime !== n.pinTime ||
      p.archived !== n.archived ||
      p.archivedAt !== n.archivedAt
    ) {
      orderRelevantChange = true
      break
    }
  }
  if (!orderRelevantChange) {
    for (const p of prev) {
      if (!p.fileId && !nextById.has(p.id)) {
        orderRelevantChange = true
        break
      }
    }
  }

  if (!orderRelevantChange) {
    // Keep previous order; patch fields from next; keep hydrated file sessions.
    const result: T[] = []
    const seen = new Set<string>()
    for (const p of prev) {
      const n = nextById.get(p.id)
      if (n) {
        result.push(n)
        seen.add(n.id)
      } else if (p.fileId) {
        result.push(p)
        seen.add(p.id)
      }
    }
    for (const n of next) {
      if (!seen.has(n.id)) result.push(n)
    }
    return result
  }

  const fileSessions = prev.filter((c) => !!c.fileId && !nextById.has(c.id))
  const sorted = [...next].sort((a, b) => {
    const d = b.updatedAt - a.updatedAt
    if (d !== 0) return d
    return (prevIndex.get(a.id) ?? 1e9) - (prevIndex.get(b.id) ?? 1e9)
  })
  return [...sorted, ...fileSessions]
}

/** Additive toggle or shift-range selection; never allow an empty selection. */
export function nextConversationSelection(opts: {
  id: string
  selectedIds: string[]
  activeId: string | null | undefined
  additive?: boolean
  range?: boolean
  rangeIds?: string[]
  listedIds: string[]
}): string[] {
  if (opts.additive) {
    const next = opts.selectedIds.includes(opts.id)
      ? opts.selectedIds.filter((existing) => existing !== opts.id)
      : [...opts.selectedIds, opts.id]
    return next.length === 0 ? [opts.id] : next
  }
  if (opts.range && opts.activeId) {
    const ids = opts.rangeIds ?? opts.listedIds
    let anchor = opts.activeId
    if (!ids.includes(anchor)) {
      const fromSelection = opts.selectedIds.find((sid) => ids.includes(sid))
      if (fromSelection) anchor = fromSelection
    }
    const from = ids.indexOf(anchor)
    const to = ids.indexOf(opts.id)
    if (from >= 0 && to >= 0) {
      const [start, end] = from < to ? [from, to] : [to, from]
      return ids.slice(start, end + 1)
    }
  }
  return [opts.id]
}

/** Archived sessions reject send / regenerate / compact / delete. */
export function isArchivedConversation(
  conversations: Array<{ id: string; archived?: boolean }>,
  id: string | null | undefined
): boolean {
  return !!id && conversations.some((conversation) => conversation.id === id && !!conversation.archived)
}

/** Archived or running sessions reject regenerate / edit / delete / fork. */
export function canMutateActiveSession(
  activeId: string | null | undefined,
  conversations: Array<{ id: string; archived?: boolean }>,
  opts?: { isRunning?: boolean; requireIdle?: boolean }
): activeId is string {
  if (!activeId) return false
  if (opts?.requireIdle !== false && opts?.isRunning) return false
  return !isArchivedConversation(conversations, activeId)
}

/** CLI-hosted sessions never compact; busy turns refuse compact (not clear). */
export function compactRefusalReason(opts: {
  cliHost?: string | null
  isRunning?: boolean
  requireIdle?: boolean
}): 'busy' | 'cli-host' | null {
  if (opts.requireIdle !== false && opts.isRunning) return 'busy'
  if (opts.cliHost) return 'cli-host'
  return null
}

/** A lone empty chat skips the confirm sheet; multi-select always confirms. */
export function shouldSkipSessionDeleteConfirm(
  targetCount: number,
  emptyCount: number
): boolean {
  return targetCount === 1 && emptyCount === 1
}

/** After deleting the active session, prefer a live chat over archive/file rows. */
export function fallbackConversationIdAfterDelete(
  conversations: Array<{ id: string; archived?: boolean; fileId?: string | null }>
): string | undefined {
  return conversations.find((c) => !c.archived && !c.fileId)?.id ?? conversations[0]?.id
}

/** Confirm-sheet copy for one vs many session deletes. */
export function sessionDeleteDialogCopy(
  targetIds: string[],
  conversations: Array<{ id: string; title?: string }>,
  t: (
    key:
      | 'dialog.deleteSession'
      | 'dialog.deleteSessions'
      | 'dialog.deleteConfirmSingle'
      | 'dialog.deleteConfirmMultiple',
    params?: { count?: number; name?: string }
  ) => string
): { title: string; body: string } {
  const single = targetIds.length === 1
  const name = conversations.find((c) => c.id === targetIds[0])?.title ?? ''
  return {
    title: single ? t('dialog.deleteSession') : t('dialog.deleteSessions', { count: targetIds.length }),
    body: single
      ? t('dialog.deleteConfirmSingle', { name })
      : t('dialog.deleteConfirmMultiple', { count: targetIds.length })
  }
}

export function genericErrorBanner(message: string): {
  errorBanner: string
  errorBannerKind: 'generic'
  errorBannerDetail: string
} {
  return {
    errorBanner: message,
    errorBannerKind: 'generic',
    errorBannerDetail: message
  }
}
