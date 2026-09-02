/**
 * Merge a listMeta broadcast into the local sidebar without reordering on
 * view-only / metadata-only updates. Recency sort applies only when some
 * conversation's `updatedAt` (or pin/archive membership) actually changed.
 *
 * Selecting a session or focusing a file must not reshuffle the list —
 * only real conversation activity (messages) bumps `updatedAt` on main.
 */

export type ConversationListItem = {
  id: string
  updatedAt: number
  pinned: boolean
  pinTime: number | null
  archived: boolean
  archivedAt: number | null
  fileId?: string | null
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
