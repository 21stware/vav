/**
 * Leaf-path projection and message upsert — kept out of sessionStore so the
 * Zustand module is not the only owner of transcript list algebra.
 */
import type { ChatMessage } from '../../../shared/types.ts'
import type { ChangeSet } from '../../../shared/changeSet.ts'
import { threadPath } from '../../../shared/thread.ts'

export type ThreadMessageState = {
  messages: Record<string, ChatMessage[]>
  activeLeaf: Record<string, string | null | undefined>
}

export type ChangeReviewState = {
  messages: Record<string, ChatMessage[]>
  changeSetsById: Record<string, ChangeSet>
  pendingReviewByConversation: Record<string, { changeSetId: string; count: number }>
  changeSet: ChangeSet | null
  changeReviewId: string | null
}

/** Stable identity for the empty case: a fresh [] would re-render forever. */
export const NO_MESSAGES: ChatMessage[] = []

let pathCache: { nodes: ChatMessage[]; leafId: string | null; path: ChatMessage[] } | null = null

/** Test hook — do not call from product code. */
export function resetVisibleMessagesCache(): void {
  pathCache = null
}

/**
 * The thread on screen: root → active leaf, with other branches left out.
 *
 * Memoised on (nodes, leaf) because this is read from selectors — returning a
 * fresh array each time would re-render forever.
 */
export function visibleMessages(state: ThreadMessageState, conversationId: string): ChatMessage[] {
  const nodes = state.messages[conversationId]
  if (!nodes?.length) return NO_MESSAGES
  const leafId = state.activeLeaf[conversationId] ?? null
  if (pathCache && pathCache.nodes === nodes && pathCache.leafId === leafId) return pathCache.path
  const path = threadPath(nodes, leafId)
  pathCache = { nodes, leafId, path }
  return path
}

export function upsert(nodes: ChatMessage[] | undefined, message: ChatMessage): ChatMessage[] {
  const existing = nodes ?? []
  const index = existing.findIndex((m) => m.id === message.id)
  if (index < 0) return [...existing, message]
  // Preserve sticky fields if a later partial snapshot omits them (e.g. mid-turn
  // persist without changeSetId must not wipe a finished review card).
  return existing.map((m) => {
    if (m.id !== message.id) return m
    const merged: ChatMessage = { ...message }
    if (!merged.changeSetId && m.changeSetId) merged.changeSetId = m.changeSetId
    return merged
  })
}

/**
 * Drop inline Change Review cards for a conversation when the next turn starts.
 * Prior changeSetIds often cannot be re-fetched (in-memory store) and surface
 * as "Could not load changes" under Done — clean them off the transcript.
 */
export function clearPriorChangeReviews(
  state: ChangeReviewState,
  conversationId: string
): Partial<ChangeReviewState> {
  const list = state.messages[conversationId]
  const dropIds = new Set(
    (list ?? []).map((m) => m.changeSetId).filter((x): x is string => !!x)
  )
  if (dropIds.size === 0 && !state.pendingReviewByConversation[conversationId]) {
    return {}
  }

  const messages = list
    ? {
        ...state.messages,
        [conversationId]: list.map((m) =>
          m.changeSetId ? { ...m, changeSetId: undefined } : m
        )
      }
    : state.messages

  const changeSetsById = { ...state.changeSetsById }
  for (const cid of dropIds) delete changeSetsById[cid]

  const pendingReviewByConversation = { ...state.pendingReviewByConversation }
  delete pendingReviewByConversation[conversationId]

  return {
    messages,
    changeSetsById,
    pendingReviewByConversation,
    changeSet: state.changeSet && dropIds.has(state.changeSet.id) ? null : state.changeSet,
    changeReviewId:
      state.changeReviewId && dropIds.has(state.changeReviewId) ? null : state.changeReviewId
  }
}
