/**
 * Reading a message tree as a conversation.
 *
 * `Conversation.messages` holds every node ever produced. What the user sees —
 * and what gets sent to the model — is the single path from the root down to
 * `activeLeafId`. Everything here is pure so the main process and the renderer
 * derive the same transcript from the same data.
 */
import type { ChatMessage } from './types'

/** Guards against a corrupted file turning traversal into an infinite loop. */
const MAX_DEPTH = 10_000

/**
 * "Positioned above the first message."
 *
 * A null leaf means "no choice made yet, follow the newest branch", which is
 * what a freshly loaded conversation wants. Forking the very first prompt needs
 * the other thing — an explicitly empty transcript — so it gets its own value.
 */
export const ROOT_LEAF = '@root'

export function indexById(messages: ChatMessage[]): Map<string, ChatMessage> {
  return new Map(messages.map((message) => [message.id, message]))
}

export function childrenOf(messages: ChatMessage[], parentId: string | null): ChatMessage[] {
  return messages.filter((message) => (message.parentId ?? null) === parentId)
}

/** Alternate versions of a message: everything sharing its parent. */
export function variantsOf(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return childrenOf(messages, message.parentId ?? null)
}

/** Follows the most recently created branch down from a node. */
export function deepestLeaf(messages: ChatMessage[], startId: string): string {
  let current = startId
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const children = childrenOf(messages, current)
    if (children.length === 0) return current
    current = children[children.length - 1].id
  }
  return current
}

/** The newest leaf overall — the fallback when no leaf has been chosen yet. */
export function newestLeafId(messages: ChatMessage[]): string | null {
  if (messages.length === 0) return null
  const parents = new Set(
    messages.map((message) => message.parentId).filter((id): id is string => !!id)
  )
  const leaves = messages.filter((message) => !parents.has(message.id))
  return (leaves[leaves.length - 1] ?? messages[messages.length - 1]).id
}

/** Root → leaf, in display order. Unknown leaves fall back to the newest one. */
export function threadPath(messages: ChatMessage[], leafId: string | null): ChatMessage[] {
  if (leafId === ROOT_LEAF) return []
  if (messages.length === 0) return []
  const byId = indexById(messages)
  let cursor = leafId ? byId.get(leafId) : undefined
  if (!cursor) {
    const fallback = newestLeafId(messages)
    cursor = fallback ? byId.get(fallback) : undefined
  }

  const path: ChatMessage[] = []
  const seen = new Set<string>()
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    path.push(cursor)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }
  return path.reverse()
}

/**
 * One place in the transcript where the thread could go more than one way.
 *
 * `targets` is what to select to follow each branch. The last entry may be the
 * branch point itself: that is the branch you just forked, which has no message
 * in it yet and so can only be named by where it starts.
 */
export interface BranchPoint {
  targets: string[]
  index: number
}

/**
 * Every fork visible on the current thread, keyed by the message the branches
 * hang off — {@link ROOT_LEAF} for the ones before the first prompt.
 *
 * Branch counts include the empty branch the user is sitting in after a fork,
 * without which forking would look like it had deleted the original reply.
 */
export function branchPoints(
  messages: ChatMessage[],
  leafId: string | null
): Map<string, BranchPoint> {
  const path = threadPath(messages, leafId)
  const points = new Map<string, BranchPoint>()
  const parents: (string | null)[] = [null, ...path.map((message) => message.id)]

  for (let depth = 0; depth < parents.length; depth++) {
    const parentId = parents[depth]
    const key = parentId ?? ROOT_LEAF
    const children = childrenOf(messages, parentId)
    const next = path[depth]
    // Last position on the thread: whatever comes next has not been said yet.
    const pending = !next
    const targets = children.map((child) => child.id)
    if (pending) targets.push(key)

    if (targets.length < 2) continue
    const index = pending
      ? targets.length - 1
      : Math.max(
          0,
          children.findIndex((child) => child.id === next.id)
        )
    points.set(key, { targets, index })
  }
  return points
}

/** `rootId` plus every descendant, walking children (not the stored array order). */
export function subtreeIds(messages: ChatMessage[], rootId: string): Set<string> {
  const byParent = new Map<string | null, string[]>()
  for (const message of messages) {
    const key = message.parentId ?? null
    const list = byParent.get(key)
    if (list) list.push(message.id)
    else byParent.set(key, [message.id])
  }
  const ids = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    if (ids.has(id)) continue
    ids.add(id)
    const kids = byParent.get(id)
    if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
  }
  return ids
}

export function pruneSubtree(
  messages: ChatMessage[],
  rootId: string
): { messages: ChatMessage[]; removed: Set<string> } {
  if (!messages.some((message) => message.id === rootId)) {
    return { messages, removed: new Set() }
  }
  const removed = subtreeIds(messages, rootId)
  return {
    messages: messages.filter((message) => !removed.has(message.id)),
    removed
  }
}

/** Leaf to follow after a subtree delete. Keeps the current path when it survived. */
export function leafAfterPrune(
  remaining: ChatMessage[],
  removed: Set<string>,
  deletedParentId: string | null,
  previousLeaf: string | null
): string | null {
  if (
    previousLeaf &&
    !removed.has(previousLeaf) &&
    remaining.some((message) => message.id === previousLeaf)
  ) {
    return previousLeaf
  }
  if (deletedParentId && remaining.some((message) => message.id === deletedParentId)) {
    return deepestLeaf(remaining, deletedParentId)
  }
  return newestLeafId(remaining)
}
