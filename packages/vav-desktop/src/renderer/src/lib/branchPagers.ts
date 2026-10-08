import type { BranchPoint } from '@shared/thread.ts'

export type PagerSlot = { key: string; index: number; count: number }

/**
 * Where each branch pager is drawn.
 *
 * A fork is keyed by the message its branches hang off, but the pager belongs
 * on the alternative being shown — under the regenerated reply, on the edited
 * prompt — not on the row above it (a retry used to put ‹ 2/2 › on the user
 * bubble, above the reply it switches). The empty branch you sit in after a
 * retry / fork has no row yet, so its pager goes to the bottom of the thread.
 */
export function placeBranchPagers(branches: Map<string, BranchPoint>): {
  byMessage: Map<string, PagerSlot>
  pending: PagerSlot | null
} {
  const byMessage = new Map<string, PagerSlot>()
  let pending: PagerSlot | null = null
  for (const [key, point] of branches) {
    const target = point.targets[point.index]
    const slot = { key, index: point.index, count: point.targets.length }
    if (!target || target === key) pending = slot
    else byMessage.set(target, slot)
  }
  return { byMessage, pending }
}
