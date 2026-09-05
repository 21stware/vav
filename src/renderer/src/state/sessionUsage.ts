import { upsertCompaction } from '../../../shared/compaction.ts'
import type { LeafCompaction } from '../../../shared/types.ts'
import { conversationTokenCachePatch, omitLiveStreamingMessage } from '../lib/messageHydration.ts'
import { patchConversationById } from './sessionListMerge.ts'

/** Drop one conversation's live token overlay without cloning when it is absent. */
export function omitLiveUsage<T>(
  liveUsage: Record<string, T>,
  id: string
): Record<string, T> {
  if (!(id in liveUsage)) return liveUsage
  const { [id]: _removed, ...rest } = liveUsage
  return rest
}

/** Status fields the transcript uses while a turn is in flight. */
export function turnRuntimeFromAgentStatus<
  T extends {
    isRunning: boolean
    phase: unknown
    toolCount: number
    awaitingToolCallId: string | null
    recovery?: unknown
  }
>(
  status: T
): Pick<T, 'isRunning' | 'phase' | 'toolCount' | 'awaitingToolCallId'> & {
  recovery?: T['recovery']
} {
  return {
    isRunning: status.isRunning,
    phase: status.phase,
    toolCount: status.toolCount,
    awaitingToolCallId: status.awaitingToolCallId,
    ...(status.recovery != null ? { recovery: status.recovery } : {})
  }
}

/**
 * Prefer the conversation actually awaiting this tool card (file preview can
 * desync `activeId`). Exact id match wins over a generic awaiting-user turn.
 */
export function conversationIdAwaitingTool(
  turns: Record<string, { awaitingToolCallId?: string | null; phase?: string }>,
  toolCallId: string,
  fallbackId: string
): string {
  let conversationId = fallbackId
  for (const [id, turn] of Object.entries(turns)) {
    if (turn.awaitingToolCallId === toolCallId || turn.phase === 'awaiting-user') {
      conversationId = id
      if (turn.awaitingToolCallId === toolCallId) break
    }
  }
  return conversationId
}

/** Remote host with a control plane can send without a local VAV API key. */
export function hostHoldsControlPlaneKeys(
  hosts: Array<{ id: string; controlPlane?: boolean }>,
  machineId: string | null | undefined
): boolean {
  return hosts.some((host) => host.id === machineId && host.controlPlane === true)
}

/** Compact success: stamp the leaf compaction and shrink the composer ring. */
export function compactionSucceededPatch<C extends { id: string; tokensUsed?: number }, U>(
  state: {
    compactions: Record<string, LeafCompaction[]>
    liveUsage: Record<string, U>
    conversations: C[]
  },
  activeId: string,
  compaction: LeafCompaction
): {
  compactions: Record<string, LeafCompaction[]>
  liveUsage: Record<string, U>
  conversations: C[]
} {
  return {
    compactions: {
      ...state.compactions,
      [activeId]: upsertCompaction(state.compactions[activeId], compaction)
    },
    liveUsage: omitLiveUsage(state.liveUsage, activeId),
    conversations: patchConversationById(state.conversations, activeId, (conversation) => ({
      ...conversation,
      tokensUsed: compaction.estimatedContextTokens
    }))
  }
}

/** Refresh token overlay maps and the conversation's tokensUsed. */
export function refreshTokenUsagePatch<C extends { id: string; tokensUsed?: number }, H>(
  state: {
    tokenHistories: Record<string, H>
    cacheCreatedAt: Record<string, number | null>
    cacheExpiresAt: Record<string, number | null>
    conversations: C[]
  },
  id: string,
  conversation: {
    tokenHistory?: H | null
    cacheCreatedAt?: number | null
    cacheExpiresAt?: number | null
    tokensUsed?: number
  }
): {
  tokenHistories: Record<string, H>
  cacheCreatedAt: Record<string, number | null>
  cacheExpiresAt: Record<string, number | null>
  conversations: C[]
} {
  return {
    ...conversationTokenCachePatch(state, id, conversation),
    conversations: patchConversationById(state.conversations, id, (row) => ({
      ...row,
      tokensUsed: conversation.tokensUsed
    }))
  }
}

/** Drop one leaf compaction after a successful clear. */
export function clearCompactionPatch<C extends { leafId: string }>(
  state: { compactions: Record<string, C[]> },
  activeId: string,
  leafId: string
): { compactions: Record<string, C[]> } {
  return {
    compactions: {
      ...state.compactions,
      [activeId]: (state.compactions[activeId] ?? []).filter((c) => c.leafId !== leafId)
    }
  }
}

/** Select: drop the live assistant snapshot and stamp turn runtime from agent.status. */
export function conversationStatusPatch<
  M extends { id: string },
  T extends {
    isRunning: boolean
    phase: unknown
    toolCount: number
    awaitingToolCallId: string | null
    recovery?: unknown
  }
>(
  state: { messages: Record<string, M[]>; turns: Record<string, ReturnType<typeof turnRuntimeFromAgentStatus<T>>> },
  id: string,
  status: T & { messageId?: string | null }
): {
  messages: Record<string, M[]>
  turns: Record<string, ReturnType<typeof turnRuntimeFromAgentStatus<T>>>
} {
  return {
    messages: omitLiveStreamingMessage(state.messages, id, status),
    turns: {
      ...state.turns,
      [id]: turnRuntimeFromAgentStatus(status)
    }
  }
}
