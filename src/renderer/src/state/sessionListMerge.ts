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
