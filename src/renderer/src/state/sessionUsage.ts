import { upsertCompaction } from '../../../shared/compaction.ts'
import type { LeafCompaction } from '../../../shared/types.ts'
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
  }
>(status: T): Pick<T, 'isRunning' | 'phase' | 'toolCount' | 'awaitingToolCallId'> {
  return {
    isRunning: status.isRunning,
    phase: status.phase,
    toolCount: status.toolCount,
    awaitingToolCallId: status.awaitingToolCallId
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
