/**
 * Per-leaf conversation compaction helpers (manual context compress).
 *
 * Full transcript stays in storage; only the model history and the default
 * transcript chrome hide earlier turns behind a summary until expanded.
 */
import { threadPath } from './thread'
import type { ChatMessage, LeafCompaction } from './types'

/** Keep at least this many path messages full after a default compact. */
export const COMPACT_KEEP_RECENT = 6
/** Need at least this many messages folded away for compact to be worth it. */
export const COMPACT_MIN_FOLDED = 2

/**
 * Rough token estimate for mixed EN/CJK text (no tokenizer in main).
 * Slightly conservative so the bar never under-reads real fill by much.
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  // ~3.2 chars/token averages Latin + CJK better than the classic /4 rule.
  return Math.max(0, Math.ceil(text.length / 3.2))
}

/**
 * Compaction that applies to this leaf's path, if any.
 * Prefers an exact leafId match; otherwise the best-fitting entry whose
 * keepAfterMessageId still sits on the path (branch grew past the tip).
 */
export function compactionForLeaf(
  compactions: LeafCompaction[] | undefined | null,
  messages: ChatMessage[],
  leafId: string | null
): LeafCompaction | null {
  if (!compactions?.length || !leafId) return null
  const path = threadPath(messages, leafId)
  if (path.length === 0) return null
  const onPath = new Set(path.map((m) => m.id))

  const applicable = compactions.filter(
    (c) => onPath.has(c.keepAfterMessageId) && (onPath.has(c.leafId) || c.leafId === leafId)
  )
  if (applicable.length === 0) {
    // Leaf grew after compact: leafId no longer on path but keepAfter still is.
    const byKeep = compactions.filter((c) => onPath.has(c.keepAfterMessageId))
    if (byKeep.length === 0) return null
    return byKeep.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  }

  const exact = applicable.find((c) => c.leafId === leafId)
  if (exact) return exact
  return applicable.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
}

/** Index of keepAfterMessageId on path, or -1. */
export function compactionBoundaryIndex(
  path: ChatMessage[],
  compaction: LeafCompaction | null
): number {
  if (!compaction) return -1
  return path.findIndex((m) => m.id === compaction.keepAfterMessageId)
}

/**
 * Default keep index for "compact earlier": fold everything before the last
 * {@link COMPACT_KEEP_RECENT} messages, requiring {@link COMPACT_MIN_FOLDED} folded.
 */
export function defaultKeepAfterIndex(pathLength: number): number | null {
  const keepIdx = Math.max(COMPACT_MIN_FOLDED, pathLength - COMPACT_KEEP_RECENT)
  if (keepIdx < COMPACT_MIN_FOLDED) return null
  if (keepIdx >= pathLength) return null
  return keepIdx
}

/** Upsert compaction for a leaf (replace same leafId). */
export function upsertCompaction(
  list: LeafCompaction[] | undefined,
  next: LeafCompaction
): LeafCompaction[] {
  const prev = list ?? []
  const without = prev.filter((c) => c.leafId !== next.leafId)
  return [...without, next]
}

export function removeCompaction(
  list: LeafCompaction[] | undefined,
  leafId: string
): LeafCompaction[] {
  return (list ?? []).filter((c) => c.leafId !== leafId)
}
